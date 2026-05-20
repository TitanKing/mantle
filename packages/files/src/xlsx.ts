/**
 * Spreadsheet text extraction. Thin wrapper around SheetJS (`xlsx`).
 *
 * Handles both modern `.xlsx` and legacy binary `.xls` (SheetJS
 * auto-detects from the bytes). Each sheet is rendered as CSV under a
 * `# Sheet: <name>` header so the LLM can tell tabs apart; blank rows
 * are dropped. Formulas resolve to their last-computed value, not the
 * formula text.
 *
 * This flattens the workbook to text — fine for "what's in this
 * spreadsheet" recall, not for preserving structure.
 *
 * Separate entry point (`@mantle/files/xlsx`) so SheetJS is only loaded
 * when a spreadsheet actually shows up.
 */

import * as XLSX from 'xlsx';

export async function parseXlsx(buf: Buffer): Promise<string> {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    if (csv.length > 0) parts.push(`# Sheet: ${name}\n${csv}`);
  }
  return parts.join('\n\n').trim();
}
