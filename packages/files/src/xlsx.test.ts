import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseXlsx } from './xlsx';

/** Build an .xlsx buffer in-memory so the round-trip test needs no fixture. */
function makeWorkbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseXlsx', () => {
  it('renders a single sheet as CSV under a header', async () => {
    const buf = makeWorkbook({
      Invoices: [
        ['Date', 'Amount', 'Paid'],
        ['2026-05-20', 1200, 'yes'],
      ],
    });
    const text = await parseXlsx(buf);
    expect(text).toContain('# Sheet: Invoices');
    expect(text).toContain('Date,Amount,Paid');
    expect(text).toContain('2026-05-20,1200,yes');
  });

  it('separates multiple sheets with their own headers', async () => {
    const buf = makeWorkbook({
      Q1: [['rev'], [100]],
      Q2: [['rev'], [200]],
    });
    const text = await parseXlsx(buf);
    expect(text).toContain('# Sheet: Q1');
    expect(text).toContain('# Sheet: Q2');
    expect(text.indexOf('# Sheet: Q1')).toBeLessThan(text.indexOf('# Sheet: Q2'));
  });

  it('drops fully blank workbooks to empty string (triggers body_too_short upstream)', async () => {
    const buf = makeWorkbook({ Empty: [] });
    expect((await parseXlsx(buf)).length).toBe(0);
  });
});
