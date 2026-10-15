import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { getSecret } from '#airo/secrets';

const maxBytes = 5 * 1024 * 1024;
const textTypes = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json', 'text/tab-separated-values']);
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const spreadsheetTypes = new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.template', 'application/vnd.ms-excel']);
const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pdfType = 'application/pdf';

function fileExtension(fileName: string) { return path.extname(fileName).toLowerCase(); }

export function inferFileType(fileName: string, declaredType: string) {
  if (declaredType && declaredType !== 'application/octet-stream') return declaredType.toLowerCase();
  const extension = fileExtension(fileName);
  return ({ '.txt': 'text/plain', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.md': 'text/markdown', '.markdown': 'text/markdown', '.json': 'application/json', '.docx': wordType, '.pdf': pdfType, '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xltx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.template', '.xls': 'application/vnd.ms-excel', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extension] ?? declaredType ?? 'application/octet-stream');
}

export function isSupportedFileType(fileName: string, fileType: string) {
  const type = inferFileType(fileName, fileType);
  return textTypes.has(type) || spreadsheetTypes.has(type) || type === wordType || type === pdfType || imageTypes.has(type);
}

export async function storeOriginalDocument(businessProfileId: string, documentId: string, fileName: string, buffer: Buffer) {
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'document';
  const directory = path.join('/private', 'pilot-documents', businessProfileId, documentId);
  const storagePath = path.join(directory, safeName);
  await mkdir(directory, { recursive: true });
  await writeFile(storagePath, buffer, { mode: 0o600 });
  return storagePath;
}

function truncate(value: string) { return value.replace(/\u0000/g, '').slice(0, 60000).trim(); }

function spreadsheetText(buffer: Buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
    if (!workbook.SheetNames.length) throw new Error('The workbook has no readable sheets.');
    const sheets = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return `Sheet: ${sheetName}\nNo readable cells found.`;
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false });
      const headers = (rows[0] ?? []).map((cell) => String(cell).trim());
      const renderedRows = rows.slice(1, 501).map((row, rowIndex) => {
        const cells = row.map((cell, columnIndex) => {
          const value = String(cell).trim();
          if (!value) return '';
          return headers[columnIndex] ? `${headers[columnIndex]}: ${value}` : `Column ${columnIndex + 1}: ${value}`;
        }).filter(Boolean);
        return cells.length ? `Row ${rowIndex + 2}: ${cells.join(' | ')}` : '';
      }).filter(Boolean);
      const headerLine = headers.filter(Boolean).length ? `Headers: ${headers.filter(Boolean).join(' | ')}` : 'Headers: none detected';
      return [`Sheet: ${sheetName}`, headerLine, ...renderedRows].join('\n');
    });
    const content = sheets.join('\n\n');
    if (!content.replace(/(?:Sheet:|Headers:|none detected|No readable cells found|\s)/g, '')) throw new Error('The workbook does not contain readable cell values.');
    return content;
  } catch (error) {
    throw new Error(error instanceof Error ? `Pilot could not read this spreadsheet: ${error.message}` : 'Pilot could not read this spreadsheet.');
  }
}

async function pdfText(buffer: Buffer) {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, useSystemFonts: true });
    const document = await loadingTask.promise;
    const pages: string[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const textContent = await page.getTextContent();
      const lines: string[] = [];
      let currentLine = '';
      let currentY: number | null = null;
      for (const item of textContent.items) {
        if (!('str' in item) || !item.str) continue;
        const y = Math.round(item.transform[5]);
        if (currentY !== null && Math.abs(y - currentY) > 2) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = '';
        }
        currentY = y;
        currentLine += `${currentLine ? ' ' : ''}${item.str}`;
      }
      if (currentLine.trim()) lines.push(currentLine.trim());
      if (lines.length) pages.push(`Page ${index}: ${lines.join('\n')}`);
    }
    await document.destroy();
    const content = pages.join('\n\n');
    if (!content.trim()) throw new Error('This PDF has no extractable text. It may be a scanned image-only PDF.');
    return content;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown PDF error';
    if (message.includes('no extractable text')) throw error;
    throw new Error(`Pilot could not read this PDF: ${message}`);
  }
}

async function imageText(buffer: Buffer, fileType: string) {
  const key = getSecret('OPENAI_API_KEY');
  if (!key) throw new Error('Image reading is not configured yet. Try a document or spreadsheet instead.');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0, max_tokens: 2500, messages: [{ role: 'user', content: [{ type: 'text', text: 'Transcribe readable business information from this image only. Preserve labels, dates, quantities, prices, suppliers, products, services, rules, order details, and spreadsheet rows. Do not infer missing information.' }, { type: 'image_url', image_url: { url: `data:${fileType};base64,${buffer.toString('base64')}` } }] }] }),
  });
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || 'Pilot could not read this image.');
  return body.choices?.[0]?.message?.content?.trim() || '';
}

export async function extractReadableFileContent(input: { fileName: string; fileType: string; base64: string }) {
  const fileType = inferFileType(input.fileName, input.fileType);
  if (!isSupportedFileType(input.fileName, fileType)) throw new Error('Pilot can read DOCX, PDF, XLSX/XLTX/XLS, CSV, TSV, TXT, Markdown, JSON, PNG, JPG, JPEG, and WEBP files.');
  const buffer = Buffer.from(input.base64, 'base64');
  if (!buffer.length || buffer.length > maxBytes) throw new Error('Choose a readable file smaller than 5 MB.');
  let content = '';
  if (textTypes.has(fileType)) content = buffer.toString('utf8');
  else if (spreadsheetTypes.has(fileType)) content = spreadsheetText(buffer);
  else if (fileType === wordType) content = (await mammoth.extractRawText({ buffer })).value;
  else if (fileType === pdfType) content = await pdfText(buffer);
  else if (imageTypes.has(fileType)) content = await imageText(buffer, fileType);
  content = truncate(content);
  if (!content) throw new Error("Pilot couldn't read this file yet. Try another supported file or tell Pilot the information directly.");
  return { fileType, buffer, content };
}
