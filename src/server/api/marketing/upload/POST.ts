/**
 * POST /api/marketing/upload
 *
 * Accepts a multipart upload of a business information document
 * (plain text, PDF text layer, or DOCX text), extracts the text,
 * runs it through the same AI extraction pipeline as the website analyzer,
 * and saves the resulting marketing profile.
 */
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { generateText } from 'ai';
import { getChatModel } from '@/lib/chatbot/chat-config.js';
import { getAuth } from '@/lib/auth/auth.js';
import { db } from '@/server/db/client.js';
import { businessProfile, marketingProfile } from '@/server/db/schema.js';

const MAX_TEXT_CHARS = 80000;

const SYSTEM_PROMPT = `You are a business analyst. You will be given text from a document describing a business.
Extract structured business information from the content. Only include information that is actually present — do not invent or assume anything.
If a field cannot be determined from the content, return null for that field.

Respond with a single valid JSON object matching this exact structure:
{
  "businessName": string | null,
  "businessDescription": string | null,
  "location": string | null,
  "contactPhone": string | null,
  "contactEmail": string | null,
  "businessHours": string | null,
  "services": string[],
  "products": string[],
  "pricing": string | null,
  "targetCustomers": string | null,
  "customerNeeds": string | null,
  "brandTone": string | null,
  "brandDescription": string | null,
  "brandColors": string | null,
  "logoUrl": string | null,
  "promotions": string | null,
  "keySellingPoints": string[],
  "frequentlyAskedQuestions": string | null,
  "importantNotes": string | null,
  "socialLinks": {
    "facebook": string | null,
    "instagram": string | null,
    "twitter": string | null,
    "linkedin": string | null,
    "tiktok": string | null,
    "youtube": string | null
  }
}

Guidelines:
- businessDescription: 2–4 sentences summarizing what the business does
- brandTone: describe the communication style (e.g. "Warm and approachable", "Professional and authoritative")
- keySellingPoints: list the most compelling reasons a customer would choose this business (max 6)
- services: list individual services offered (not categories)
- products: list individual products if it's a product-based business
- pricing: summarize pricing information found, or null if none found
- socialLinks: only include URLs that are explicitly present in the content`;

function safeJson(text: string): Record<string, unknown> {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as Record<string, unknown>;
  } catch { /* fall through */ }
  return {};
}

function str(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function socialObj(v: unknown): Record<string, string | null> {
  const defaults = { facebook: null, instagram: null, twitter: null, linkedin: null, tiktok: null, youtube: null };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return defaults;
  const obj = v as Record<string, unknown>;
  return {
    facebook: typeof obj.facebook === 'string' ? obj.facebook : null,
    instagram: typeof obj.instagram === 'string' ? obj.instagram : null,
    twitter: typeof obj.twitter === 'string' ? obj.twitter : null,
    linkedin: typeof obj.linkedin === 'string' ? obj.linkedin : null,
    tiktok: typeof obj.tiktok === 'string' ? obj.tiktok : null,
    youtube: typeof obj.youtube === 'string' ? obj.youtube : null,
  };
}

/** Extract plain text from a Buffer based on MIME type / filename */
function extractText(buffer: Buffer, filename: string, mimetype: string): string {
  const lower = filename.toLowerCase();

  // Plain text / markdown
  if (mimetype.startsWith('text/') || lower.endsWith('.txt') || lower.endsWith('.md')) {
    return buffer.toString('utf-8').slice(0, MAX_TEXT_CHARS);
  }

  // DOCX: extract raw XML text (works without a full DOCX parser)
  if (lower.endsWith('.docx') || mimetype.includes('wordprocessingml') || mimetype.includes('openxmlformats')) {
    // DOCX is a ZIP; we can pull text from the raw bytes by finding XML text nodes
    const raw = buffer.toString('latin1');
    const xmlMatches = raw.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [];
    const text = xmlMatches.map((m) => m.replace(/<[^>]+>/g, '')).join(' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, MAX_TEXT_CHARS);
  }

  // PDF: extract text layer from raw bytes (basic — works for text-layer PDFs)
  if (lower.endsWith('.pdf') || mimetype === 'application/pdf') {
    const raw = buffer.toString('latin1');
    // Extract text between BT/ET markers (basic PDF text extraction)
    const btMatches = raw.match(/BT[\s\S]*?ET/g) ?? [];
    const textParts: string[] = [];
    for (const block of btMatches) {
      const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g) ?? [];
      for (const tj of tjMatches) {
        const inner = tj.match(/\(([^)]*)\)/)?.[1] ?? '';
        if (inner.trim()) textParts.push(inner);
      }
    }
    const text = textParts.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length > 100) return text.slice(0, MAX_TEXT_CHARS);
    // Fallback: grab any readable ASCII sequences from the raw bytes
    const ascii = raw.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
    return ascii.slice(0, MAX_TEXT_CHARS);
  }

  // Fallback: treat as UTF-8 text
  return buffer.toString('utf-8').slice(0, MAX_TEXT_CHARS);
}

export default async function handler(req: Request, res: Response) {
  try {
    const session = await getAuth().api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
    if (!session?.user?.id) { res.status(401).json({ error: 'Please sign in.' }); return; }

    const profiles = await db.select().from(businessProfile).where(eq(businessProfile.userId, session.user.id)).limit(1);
    const profile = profiles[0];
    if (!profile) { res.status(404).json({ error: 'Business profile not found.' }); return; }

    // multer attaches files to req.files or req.file
    const files = req.files as Express.Multer.File[] | undefined;
    const singleFile = req.file as Express.Multer.File | undefined;
    const uploaded = singleFile ?? files?.[0];

    if (!uploaded) { res.status(400).json({ error: 'Please upload a document.' }); return; }

    const { buffer, originalname, mimetype } = uploaded;
    const text = extractText(buffer, originalname, mimetype);

    if (!text || text.length < 50) {
      res.status(422).json({ error: 'Pilot couldn\'t read that document. Please try a plain text (.txt) or Word (.docx) file.' });
      return;
    }

    // Extract structured data with AI
    // Use top-level `system` param — the openai.responses provider does not
    // accept system role inside the messages array.
    const { text: aiResponse } = await generateText({
      model: getChatModel(),
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Document filename: ${originalname}\n\nDocument content:\n${text}` },
      ],
      temperature: 0.1,
      maxTokens: 2000,
    });

    const raw = safeJson(aiResponse);

    const extracted = {
      websiteUrl: null,
      analysisStatus: 'complete' as const,
      analyzedAt: new Date(),
      approvalStatus: 'review_required' as const,
      confirmedAt: null,
      businessName: str(raw.businessName, 255) || null,
      businessDescription: str(raw.businessDescription) || null,
      location: str(raw.location, 512) || null,
      contactPhone: str(raw.contactPhone, 80) || null,
      contactEmail: str(raw.contactEmail, 255) || null,
      businessHours: str(raw.businessHours) || null,
      services: JSON.stringify(strArr(raw.services)),
      products: JSON.stringify(strArr(raw.products)),
      pricing: str(raw.pricing) || null,
      targetCustomers: str(raw.targetCustomers) || null,
      customerNeeds: str(raw.customerNeeds) || null,
      brandTone: str(raw.brandTone, 255) || null,
      brandDescription: str(raw.brandDescription) || null,
      brandColors: str(raw.brandColors, 255) || null,
      logoUrl: str(raw.logoUrl, 2048) || null,
      promotions: str(raw.promotions) || null,
      keySellingPoints: JSON.stringify(strArr(raw.keySellingPoints)),
      frequentlyAskedQuestions: str(raw.frequentlyAskedQuestions) || null,
      importantNotes: str(raw.importantNotes) || null,
      socialLinks: JSON.stringify(socialObj(raw.socialLinks)),
    };

    const existing = await db.select({ id: marketingProfile.id }).from(marketingProfile).where(eq(marketingProfile.businessProfileId, profile.id)).limit(1);

    if (existing[0]) {
      await db.update(marketingProfile).set(extracted).where(eq(marketingProfile.businessProfileId, profile.id));
    } else {
      await db.insert(marketingProfile).values({ id: randomUUID(), businessProfileId: profile.id, ...extracted });
    }

    const rows = await db.select().from(marketingProfile).where(eq(marketingProfile.businessProfileId, profile.id)).limit(1);
    res.json({ marketingProfile: rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Pilot was unable to read that document. Please try again.', message: String(error) });
  }
}
