import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { businessKnowledgeSource } from '@/server/db/schema.js';
import type { CrawledWebsitePage } from '@/server/business-knowledge/website-crawl.js';

export async function replaceWebsiteKnowledgeSources(businessProfileId: string, records: CrawledWebsitePage[]) {
  await db.transaction(async (tx) => {
    await tx.delete(businessKnowledgeSource).where(eq(businessKnowledgeSource.businessProfileId, businessProfileId));
    if (records.length) {
      await tx.insert(businessKnowledgeSource).values(records.map((record) => ({
        id: randomUUID(),
        businessProfileId,
        sourceUrl: record.url.slice(0, 2048),
        content: record.text.slice(0, 18000),
      })));
    }
  });
}
