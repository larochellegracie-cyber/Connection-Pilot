import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { extractReadableFileContent, inferFileType, isSupportedFileType } from './file-extraction.js';

function createTextPdf(lines: string[]) {
  const stream = `BT /F1 12 Tf 72 720 Td (${lines.join(') Tj 0 -16 Td (')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

function uploadInput(fileName: string, fileType: string, buffer: Buffer) {
  return { fileName, fileType, base64: buffer.toString('base64') };
}

describe('Teach Pilot document extraction', () => {
  it('extracts text from the Staci Bakes PDF content for the review pipeline', async () => {
    const pdf = createTextPdf(['Chocolate Cupcakes — $36/dozen', 'Vanilla Cupcakes — $34/dozen', 'Brownies — $24/dozen', 'Chocolate Cupcake Recipe', '2 cups flour', 'ABC Baking Supply', 'Flour delivery: approximately 3 days', 'Minimum order: 10 bags', 'Appointments must be at least 30 minutes apart.']);
    const result = await extractReadableFileContent(uploadInput('staci_bakes_test.pdf', 'application/pdf', pdf));

    expect(result.content).toContain('Chocolate Cupcakes');
    expect(result.content).toContain('$36/dozen');
    expect(result.content).toContain('Chocolate Cupcake Recipe');
    expect(result.content).toContain('ABC Baking Supply');
    expect(result.content).toContain('Minimum order: 10 bags');
    expect(result.content).toContain('Appointments must be at least 30 minutes apart.');
  });

  it('rejects image-only PDFs without inventing text', async () => {
    const blankPdf = createTextPdf([]);
    await expect(extractReadableFileContent(uploadInput('scan.pdf', 'application/pdf', blankPdf))).rejects.toThrow('no extractable text');
  });

  it('retains workbook sheet, header, and row context for review', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Product', 'Price'], ['Chocolate Cupcakes', '$36/dozen'], ['Vanilla Cupcakes', '$34/dozen'], ['Brownies', '$24/dozen']]), 'Products');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Recipe', 'Ingredient', 'Quantity'], ['Chocolate Cupcakes', 'Flour', '2 cups'], ['Chocolate Cupcakes', 'Cocoa powder', '3/4 cup']]), 'Recipes');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Supplier', 'Lead time', 'Minimum order'], ['ABC Baking Supply', 'Approximately 3 days for flour', '10 bags of flour']]), 'Suppliers');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Policy'], ['Appointments must be at least 30 minutes apart']]), 'Rules');
    const xlsx = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const result = await extractReadableFileContent(uploadInput('staci_bakes_test_fixed.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsx));

    expect(result.content).toContain('Sheet: Products');
    expect(result.content).toContain('Headers: Recipe | Ingredient | Quantity');
    expect(result.content).toContain('Row 2: Supplier: ABC Baking Supply | Lead time: Approximately 3 days for flour | Minimum order: 10 bags of flour');
    expect(result.content).toContain('Row 2: Policy: Appointments must be at least 30 minutes apart');
  });

  it('detects an XLTX template by extension when the browser supplies a generic MIME type', () => {
    const fileType = inferFileType('bakery-pricing.xltx', 'application/octet-stream');

    expect(fileType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.template');
    expect(isSupportedFileType('bakery-pricing.xltx', 'application/octet-stream')).toBe(true);
  });

  it('routes an XLTX upload MIME type through the spreadsheet parser with worksheet context intact', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Service', 'Rate'], ['Custom cakes', '$125']]), 'Template pricing');
    const spreadsheetPackage = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const result = await extractReadableFileContent(uploadInput('bakery-pricing.xltx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.template', spreadsheetPackage));

    expect(result.fileType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.template');
    expect(result.content).toContain('Sheet: Template pricing');
    expect(result.content).toContain('Headers: Service | Rate');
    expect(result.content).toContain('Row 2: Service: Custom cakes | Rate: $125');
  });
  it('reports unsupported files clearly', async () => {
    await expect(extractReadableFileContent(uploadInput('unsupported.exe', 'application/octet-stream', Buffer.from('nope')))).rejects.toThrow('Pilot can read');
  });
});
