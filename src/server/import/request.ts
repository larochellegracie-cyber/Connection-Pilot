import { isImportKind } from './classify.js';
import { clean } from './normalize.js';
import type { ImportRequest, ParsedSheet, RecordChoice, SheetDecision } from './types.js';

const choices: RecordChoice[] = ['skip', 'create', 'update', 'merge'];
const maxSheets = 40;

/** Checks the shape of what the browser sent, so nothing unexpected reaches the planner. */
export function importRequestFrom(body: unknown): ImportRequest | { error: string } {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  if (!Array.isArray(input.sheets) || !Array.isArray(input.decisions) || input.sheets.length > maxSheets) return { error: 'The import request is not valid. Start over and upload your files again.' };
  const sheets: ParsedSheet[] = [];
  for (const raw of input.sheets) {
    const sheet = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    if (!sheet || typeof sheet.id !== 'string' || !Array.isArray(sheet.headers) || !Array.isArray(sheet.rows) || sheet.rows.length > 5000) return { error: 'The import request is not valid. Start over and upload your files again.' };
    sheets.push({ id: clean(sheet.id, 600), fileName: clean(sheet.fileName, 255), sheetName: clean(sheet.sheetName, 255), headers: sheet.headers.map((header) => clean(header)), rows: sheet.rows.map((row) => (Array.isArray(row) ? row.map((cell) => clean(cell, 2000)) : [])), truncated: Boolean(sheet.truncated) });
  }
  const decisions: SheetDecision[] = [];
  for (const raw of input.decisions) {
    const decision = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    if (!decision || typeof decision.id !== 'string' || typeof decision.kind !== 'string') continue;
    if (decision.kind !== 'ignore' && !isImportKind(decision.kind)) continue;
    const mapping: Record<string, string> = {};
    if (decision.mapping && typeof decision.mapping === 'object') for (const [column, field] of Object.entries(decision.mapping)) if (typeof field === 'string') mapping[column] = clean(field, 40);
    decisions.push({ id: decision.id, kind: decision.kind as SheetDecision['kind'], mapping });
  }
  const recordChoices: Record<string, RecordChoice> = {};
  if (input.recordChoices && typeof input.recordChoices === 'object') for (const [key, value] of Object.entries(input.recordChoices)) if (typeof value === 'string' && (choices as string[]).includes(value)) recordChoices[key] = value as RecordChoice;
  return { sheets, decisions, recordChoices };
}
