import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { suggestMapping, suggestSheet } from './classify';
import { parseTabularFile } from './parse';

const sheet = (headers: string[], fileName = 'export.xlsx', sheetName = 'Sheet1') => suggestSheet({ id: 'a', fileName, sheetName, headers });

describe('Pilot sheet recognition', () => {
  it('recognises a customer list', () => {
    const result = sheet(['Name', 'Phone', 'Email', 'Address']);
    expect(result.kind).toBe('customers');
    expect(result.confidence).toBe('high');
    expect(result.mappings.customers).toEqual({ '0': 'name', '1': 'phone', '2': 'email', '3': 'address' });
  });

  it('recognises a customer list with split names and a company', () => {
    expect(sheet(['First Name', 'Last Name', 'Mobile', 'E-mail', 'Company']).kind).toBe('customers');
  });

  it('recognises invoices', () => {
    const result = sheet(['Invoice #', 'Customer', 'Date', 'Amount', 'Status']);
    expect(result.kind).toBe('invoices');
    expect(result.mappings.invoices).toMatchObject({ '0': 'number', '1': 'customerName', '2': 'date', '3': 'total', '4': 'status' });
  });

  it('recognises quotes and estimates', () => {
    expect(sheet(['Quote No', 'Client', 'Date', 'Total', 'Status']).kind).toBe('quotes');
    expect(sheet(['Estimate #', 'Customer', 'Valid Until', 'Total']).kind).toBe('quotes');
  });

  it('uses the file name when the headers alone are ambiguous', () => {
    const result = sheet(['Number', 'Customer', 'Date', 'Total', 'Status'], 'quotes-2024.csv');
    expect(result.kind).toBe('quotes');
  });

  it('asks instead of guessing when invoices and quotes look identical', () => {
    const result = sheet(['Number', 'Customer', 'Date', 'Total', 'Status'], 'export.csv');
    expect(result.confidence).toBe('unsure');
  });

  it('recognises jobs', () => {
    expect(sheet(['Customer', 'Service', 'Date', 'Assigned To', 'Status', 'Address']).kind).toBe('jobs');
  });

  it('recognises employees', () => {
    const result = sheet(['Employee', 'Role', 'Email', 'Phone']);
    expect(result.kind).toBe('employees');
  });

  it('recognises a price list as services', () => {
    const result = sheet(['Service', 'Price', 'Unit']);
    expect(result.kind).toBe('services');
    expect(result.mappings.services).toEqual({ '0': 'name', '1': 'price', '2': 'unit' });
  });

  it('notices a weekly schedule grid but does not treat it as importable records', () => {
    expect(sheet(['Employee', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']).kind).toBe('schedule');
  });

  it('says unknown for sheets it cannot place', () => {
    const result = sheet(['Foo', 'Bar', 'Baz']);
    expect(result.kind).toBe('unknown');
    expect(result.confidence).toBe('unsure');
  });

  it('leaves unfamiliar columns unmapped for the owner to decide', () => {
    const mapping = suggestMapping(['Name', 'Phone', 'Cust. Type'], 'customers');
    expect(mapping).toEqual({ '0': 'name', '1': 'phone' });
  });
});

describe('reading spreadsheet files', () => {
  const book = (rows: unknown[][], bookType: XLSX.BookType = 'xlsx', sheetName = 'Customers') => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
    return XLSX.write(workbook, { type: 'base64', bookType }) as string;
  };

  it('reads headers and rows from an Excel file', () => {
    const [parsed] = parseTabularFile('customers.xlsx', book([['Name', 'Phone'], ['Jo Rivera', '555-010-0001'], ['', ''], ['Sam Lee', '555-010-0002']]));
    expect(parsed.headers).toEqual(['Name', 'Phone']);
    expect(parsed.rows).toEqual([['Jo Rivera', '555-010-0001'], ['Sam Lee', '555-010-0002']]);
    expect(parsed.sheetName).toBe('Customers');
  });

  it('reads CSV with quoted commas', () => {
    const csv = Buffer.from('Name,Address\n"Rivera, Jo","1 Main St, Unit 2"\n').toString('base64');
    const [parsed] = parseTabularFile('c.csv', csv);
    expect(parsed.rows).toEqual([['Rivera, Jo', '1 Main St, Unit 2']]);
  });

  it('reads tab-separated files', () => {
    const tsv = Buffer.from('Name\tPhone\nJo\t5550100001\n').toString('base64');
    const [parsed] = parseTabularFile('c.tsv', tsv);
    expect(parsed.headers).toEqual(['Name', 'Phone']);
  });

  it('gives blank headers a name and skips sheets with no data', () => {
    const [parsed] = parseTabularFile('c.xlsx', book([['Name', ''], ['Jo', 'x']]));
    expect(parsed.headers).toEqual(['Name', 'Column 2']);
    expect(() => parseTabularFile('c.xlsx', book([['Name', 'Phone']]))).toThrow(/rows of data/);
  });

  it('refuses file types it cannot turn into records', () => {
    expect(() => parseTabularFile('notes.pdf', 'AAAA')).toThrow(/can import/);
  });
});
