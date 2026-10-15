import { getSecret } from '#airo/secrets';
import { getAuth } from '@/lib/auth/auth.js';
import { crawlBusinessWebsite } from '@/server/business-knowledge/website-crawl.js';

type BusinessSummary = { businessName: string; businessType: string; location: string; businessHours: string; servicesOffered: string };
type Knowledge = { serviceArea: string; pricingInformation: string; frequentlyAskedQuestions: string; policies: string; receptionistInstructions: string };
type Preview = BusinessSummary & { knowledge: Knowledge };

const summaryKeys = ['businessName', 'businessType', 'location', 'businessHours', 'servicesOffered'] as const;
const knowledgeKeys = ['serviceArea', 'pricingInformation', 'frequentlyAskedQuestions', 'policies', 'receptionistInstructions'] as const;

function clean(value: unknown, limit = 12000): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function fileText(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  if (!raw.startsWith('%PDF')) return clean(raw, 30000);
  return (raw.match(/\((?:\\.|[^\\)])*\)/g)?.map((part) => part.slice(1, -1).replace(/\\([()\\])/g, '$1')).join(' ') || '').slice(0, 30000);
}

function blankPreview(): Preview {
  return { businessName: '', businessType: '', location: '', businessHours: '', servicesOffered: '', knowledge: { serviceArea: '', pricingInformation: '', frequentlyAskedQuestions: '', policies: '', receptionistInstructions: '' } };
}

function outputText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === 'string') return response.output_text;
  return response.output?.flatMap((item) => item.content ?? []).find((content) => content.type === 'output_text')?.text ?? '';
}

function heuristic(source: string): Preview {
  const preview = blankPreview();
  const compact = source.replace(/\s+/g, ' ').trim();
  const named = compact.match(/\b(?:called|named)\s+[“”"']?([^.,;!]+?)[”"']?(?=\s+(?:in|at|from|located|based|and|we|that|which)\b|[.,;!]|$)/i);
  preview.businessName = clean(named?.[1], 255);
  const businessType = compact.match(/\b(bakery|plumber|plumbing|electrician|landscaper|salon|barbershop|cleaning service|contractor|HVAC|roofing|painter|photographer|accountant|bookkeeper|law firm|restaurant|cafe|coffee shop|florist|auto repair|mechanic|dentist|clinic|real estate|consulting)\b/i);
  preview.businessType = clean(businessType?.[1], 100);
  const location = compact.match(/\b(?:located|based|serving|in|at)\s+([A-Z][A-Za-z .'-]{1,80}?)(?=\s*(?:,|\.|;|!|\b(?:and|we|open|offering|offer|sell|provide|specializ))|$)/);
  preview.location = clean(location?.[1], 255);
  preview.knowledge.serviceArea = preview.location;
  const hours = compact.match(/\b(?:(?:we(?:'re| are)?|i(?:'m| am)?)\s*)?(?:open|available|work(?:ing)? hours?(?: are)?)\s+([^.!;]+)/i);
  preview.businessHours = clean(hours?.[0], 1000);
  const services = compact.match(/\b(?:we\s+)?(?:sell|offer|provide|speciali[sz]e in|do)\s+([^.!;]+)/i);
  preview.servicesOffered = clean(services?.[1], 12000);
  return preview;
}

function normalize(value: Partial<Preview>, fallback: Preview, rawSources: string): Preview {
  const preview = blankPreview();
  for (const key of summaryKeys) preview[key] = clean(value[key], key === 'servicesOffered' ? 12000 : 1000) || fallback[key];
  const proposedKnowledge: Partial<Knowledge> = value.knowledge ?? {};
  for (const key of knowledgeKeys) preview.knowledge[key] = clean(proposedKnowledge[key], key === 'receptionistInstructions' ? 12000 : 10000) || fallback.knowledge[key];
  preview.knowledge.receptionistInstructions = `${preview.knowledge.receptionistInstructions}${rawSources ? `\n\nImported source material:\n${rawSources.slice(0, 9000)}` : ''}`.trim().slice(0, 12000);
  return preview;
}

export default async function handler(req: Request, res: Response) {
  const session = await getAuth().api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
  if (!session?.user?.id) { res.status(401).json({ error: 'Please sign in before setting up your business.' }); return; }

  const ownerNote = clean(req.body?.description, 3000);
  const uploadedFile = fileText(req.body?.supplementalText);
  const requestedWebsite = clean(req.body?.website, 255);
  let website = '';
  let websiteSource = '';
  let crawledPages: string[] = [];
  if (requestedWebsite) {
    try {
      const crawl = await crawlBusinessWebsite(requestedWebsite);
      website = crawl.website;
      websiteSource = crawl.sourceText;
      crawledPages = crawl.pages;
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Pilot could not read that website. Check the URL and try again.' }); return;
    }
  }
  const source = `${ownerNote ? `Tell Pilot:\n${ownerNote}` : ''}${uploadedFile ? `\n\nUploaded file:\n${uploadedFile}` : ''}${websiteSource ? `\n\nWebsite crawl:\n${websiteSource}` : ''}`.trim();
  if (!source) { res.status(400).json({ error: 'Add information through Tell Pilot, your website, or an uploaded file.' }); return; }

  const fallback = heuristic(source);
  const apiKey = getSecret('OPENAI_API_KEY');
  if (!apiKey || typeof apiKey !== 'string') { res.json({ summary: fallback, website, crawledPages }); return; }
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5-mini', reasoning: { effort: 'minimal' }, max_output_tokens: 1600,
        text: { format: { type: 'json_schema', name: 'onboarding_business_knowledge', strict: true, schema: { type: 'object', additionalProperties: false, required: [...summaryKeys, 'knowledge'], properties: { businessName: { type: 'string' }, businessType: { type: 'string' }, location: { type: 'string' }, businessHours: { type: 'string' }, servicesOffered: { type: 'string' }, knowledge: { type: 'object', additionalProperties: false, required: knowledgeKeys, properties: { serviceArea: { type: 'string' }, pricingInformation: { type: 'string' }, frequentlyAskedQuestions: { type: 'string' }, policies: { type: 'string' }, receptionistInstructions: { type: 'string' } } } } } } },
        instructions: 'Combine all supplied owner note, uploaded-file text, and website-crawl text into one factual business knowledge record. Extract only information stated in the sources; never invent facts, prices, policies, or answers. Capture menu items, product descriptions, prices when explicitly shown, FAQs, policies, ordering, delivery, pickup, and other useful business-specific details in the appropriate knowledge fields. Use concise readable lists. Leave fields empty when sources do not establish them.', input: source,
      }),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) { res.json({ summary: normalize({}, fallback, websiteSource), website, crawledPages }); return; }
    const parsed = JSON.parse(outputText(payload) || '{}') as Partial<Preview>;
    res.json({ summary: normalize(parsed, fallback, websiteSource), website, crawledPages });
  } catch (error) {
    console.error('onboarding.preview.fallback', { message: error instanceof Error ? error.message : 'Unknown error' });
    res.json({ summary: normalize({}, fallback, websiteSource), website, crawledPages });
  }
}
