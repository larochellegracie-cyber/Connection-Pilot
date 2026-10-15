import type { Request, Response } from 'express';
import { getSecret } from '#airo/secrets';
import { getAuth } from '@/lib/auth/auth.js';
import { crawlBusinessWebsite } from '@/server/business-knowledge/website-crawl.js';

type Suggestion = Record<'businessName' | 'businessType' | 'address' | 'city' | 'region' | 'postalCode' | 'website' | 'serviceArea' | 'businessHours' | 'servicesOffered' | 'pricingInformation' | 'frequentlyAskedQuestions' | 'policies' | 'receptionistInstructions', string>;

const keys = ['businessName', 'businessType', 'address', 'city', 'region', 'postalCode', 'website', 'serviceArea', 'businessHours', 'servicesOffered', 'pricingInformation', 'frequentlyAskedQuestions', 'policies', 'receptionistInstructions'] as const;

function clean(value: unknown, limit = 12000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function blankSuggestion(): Suggestion {
  return Object.fromEntries(keys.map((key) => [key, ''])) as Suggestion;
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === 'string') return response.output_text;
  return response.output?.flatMap((item) => item.content ?? []).find((content) => content.type === 'output_text')?.text ?? '';
}


export default async function handler(req: Request, res: Response) {
  try {
    const session = await getAuth().api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
    if (!session?.user?.id) {
      res.status(401).json({ error: 'Please sign in before adding business knowledge.' });
      return;
    }
    const source = clean(req.body?.source, 30);
    let sourceText = '';
    if (source === 'tell') sourceText = clean(req.body?.text, 60000);
    if (source === 'file') sourceText = clean(req.body?.text, 60000);
    if (source === 'website') {
      try {
        const crawl = await crawlBusinessWebsite(clean(req.body?.url, 255));
        sourceText = crawl.sourceText;
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Pilot could not read that website. Check the URL and try again.' });
        return;
      }
    }
    if (!sourceText) {
      res.status(400).json({ error: 'Add some business information before asking Pilot to review it.' });
      return;
    }
    const apiKey = getSecret('OPENAI_API_KEY');
    if (!apiKey || typeof apiKey !== 'string') {
      res.json({ suggestion: blankSuggestion() });
      return;
    }
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        reasoning: { effort: 'minimal' },
        max_output_tokens: 900,
        text: { format: { type: 'json_schema', name: 'business_knowledge_suggestion', strict: true, schema: { type: 'object', additionalProperties: false, required: [...keys], properties: Object.fromEntries(keys.map((key) => [key, { type: 'string' }])) } } },
        instructions: 'Extract only stated business facts from the source. Return empty strings for facts absent from the source. Do not invent facts. Make services, prices, FAQs, policies, and Pilot guidance concise, readable lists where information is present.',
        input: sourceText,
      }),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) {
      res.status(502).json({ error: 'Pilot could not prepare suggestions from that source.' });
      return;
    }
    const parsed = JSON.parse(extractText(payload) || '{}') as Partial<Suggestion>;
    const suggestion = blankSuggestion();
    for (const key of keys) suggestion[key] = clean(parsed[key]);
    if (source === 'website') suggestion.receptionistInstructions = `${suggestion.receptionistInstructions}\n\nImported website source material:\n${sourceText.slice(0, 9000)}`.trim().slice(0, 12000);
    res.json({ suggestion });
  } catch (error) {
    res.status(500).json({ error: 'Pilot could not prepare suggestions from that source.', message: String(error) });
  }
}
