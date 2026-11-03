import path from 'node:path';
import * as XLSX from 'xlsx';
import { clean } from './normalize.js';
import type { ParsedSheet } from './types.js';

const maxBytes = 5 * 1024 * 1024;
export const maxRowsPerSheet = 5000;
/** The file types Pilot can turn into records. Documents and images stay with Pilot's document reader. */
export const importFileExtensions = ['.csv', '.tsv', '.xlsx', '.xltx', '.xls'] as const;

export function isImportableFile(fileName: string): boolean { return (importFileExtensions as readonly string[]).includes(path.extname(fileName).toLowerCase()); }

/** Reads a spreadsheet or CSV into plain tables. Nothing is interpreted here. */
export function parseTabularFile(fileName: string, base64: string): ParsedSheet[] {
  if (!isImportableFile(fileName)) throw new Error(`Pilot can import ${importFileExtensions.join(', ')} files.`);
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('That file is empty.');
  if (buffer.length > maxBytes) throw new Error('Choose a file smaller than 5 MB.');
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true }); }
  catch (error) { throw new Error(`Pilot could not read this file: ${error instanceof Error ? error.message : 'unknown error'}`); }
  const sheets: ParsedSheet[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false });
    const rows = grid.map((row) => row.map((cell) => clean(cell, 2000))).filter((row) => row.some(Boolean));
    if (rows.length < 2) continue; // a header with no data (or an empty sheet) has nothing to import
    const width = Math.max(...rows.map((row) => row.length));
    const headers = Array.from({ length: width }, (_, index) => clean(rows[0][index]) || `Column ${index + 1}`);
    const body = rows.slice(1, maxRowsPerSheet + 1).map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
    sheets.push({ id: `${fileName}::${sheetName}`, fileName, sheetName, headers, rows: body, truncated: rows.length - 1 > maxRowsPerSheet });
  }
  if (!sheets.length) throw new Error('Pilot could not find any rows of data in this file.');
  return sheets;
}
