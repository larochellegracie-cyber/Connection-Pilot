import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

import { extractReadableFileContent, isSupportedFileType, storeOriginalDocument } from './file-extraction';
import { extractDocumentFacts } from './document-intelligence';

const b64 = (value: string | Buffer | Uint8Array) => Buffer.from(value).toString('base64');

async function docx(text: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function pdf(text: string) {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

function xlsx() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Service', 'Price'], ['Pool cleaning', 120], ['Pool opening', 300]]), 'Prices');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// A 1x1 PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('extractReadableFileContent: every supported format', () => {
  beforeEach(() => { delete process.env.OPENAI_API_KEY; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each([
    ['notes.txt', 'text/plain', 'We open at 8am on weekdays.'],
    ['menu.md', 'text/markdown', '# Prices\n- Cleaning: $120'],
    ['info.json', 'application/json', '{"hours":"8-5"}'],
  ])('reads %s', async (fileName, fileType, text) => {
    const result = await extractReadableFileContent({ fileName, fileType, base64: b64(text) });
    expect(result.content).toContain(text.split('\n')[0]);
  });

  it.each([
    ['prices.csv', 'text/csv', 'Service,Price\nPool cleaning,120\nPool opening,300'],
    ['prices.tsv', 'text/tab-separated-values', 'Service\tPrice\nPool cleaning\t120\nPool opening\t300'],
  ])('reads %s like a spreadsheet, so Pilot can find the prices in it', async (fileName, fileType, text) => {
    const result = await extractReadableFileContent({ fileName, fileType, base64: b64(text) });
    expect(result.content).toContain('Service: Pool cleaning | Price: 120');
    const prices = extractDocumentFacts(result.content).facts.filter((item) => item.kind === 'price');
    expect(prices.map((item) => [item.subject, item.value])).toEqual([['Pool cleaning', '120'], ['Pool opening', '300']]);
  });

  it('reads a Word document (DOCX)', async () => {
    const result = await extractReadableFileContent({ fileName: 'policy.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: b64(await docx('Refunds within 14 days')) });
    expect(result.content).toContain('Refunds within 14 days');
  });

  it('reads a spreadsheet (XLSX), keeping each value with its column heading', async () => {
    const result = await extractReadableFileContent({ fileName: 'prices.xlsx', fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: b64(xlsx()) });
    expect(result.content).toContain('Service: Pool cleaning');
    expect(result.content).toContain('Price: 300');
  });

  it('reads a PDF', async () => {
    const result = await extractReadableFileContent({ fileName: 'quote.pdf', fileType: 'application/pdf', base64: b64(pdf('Pool cleaning costs 120 dollars')) });
    expect(result.content).toContain('Pool cleaning costs 120 dollars');
  });

  it('explains clearly that an image needs the OpenAI key when it is missing', async () => {
    await expect(extractReadableFileContent({ fileName: 'menu.png', fileType: 'image/png', base64: b64(png) })).rejects.toThrow(/not configured/i);
  });

  it('reads an image through OpenAI when a key is set', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Open 8-5 Monday to Friday' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await extractReadableFileContent({ fileName: 'sign.png', fileType: 'image/png', base64: b64(png) });
    expect(result.content).toBe('Open 8-5 Monday to Friday');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects an unsupported type and an oversized file with a clear message', async () => {
    expect(isSupportedFileType('movie.mp4', 'video/mp4')).toBe(false);
    await expect(extractReadableFileContent({ fileName: 'movie.mp4', fileType: 'video/mp4', base64: b64('x') })).rejects.toThrow(/can read DOCX/);
    await expect(extractReadableFileContent({ fileName: 'big.txt', fileType: 'text/plain', base64: b64(Buffer.alloc(5 * 1024 * 1024 + 1, 97)) })).rejects.toThrow(/smaller than 5 MB/);
  });
});

describe('storeOriginalDocument', () => {
  let folder = '';
  beforeEach(async () => { folder = await mkdtemp(path.join(tmpdir(), 'pilot-docs-')); delete process.env.PILOT_DOCUMENT_STORAGE_DIR; });
  afterEach(async () => { delete process.env.PILOT_DOCUMENT_STORAGE_DIR; await rm(folder, { recursive: true, force: true }); });

  it('does not touch the disk unless a persistent folder is configured (so uploads work anywhere)', async () => {
    expect(await storeOriginalDocument('biz', 'doc', 'a.txt', Buffer.from('hi'))).toBeNull();
  });

  it('keeps a copy of the original in the configured folder', async () => {
    process.env.PILOT_DOCUMENT_STORAGE_DIR = folder;
    const stored = await storeOriginalDocument('biz', 'doc', 'my file.txt', Buffer.from('hi'));
    expect(stored).toBe(path.join(folder, 'biz', 'doc', 'my_file.txt'));
    expect(await readFile(stored as string, 'utf8')).toBe('hi');
  });

  it('never fails the upload when the folder cannot be written', async () => {
    process.env.PILOT_DOCUMENT_STORAGE_DIR = '/proc/not-writable';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await storeOriginalDocument('biz', 'doc', 'a.txt', Buffer.from('hi'))).toBeNull();
  });
});
