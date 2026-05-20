/**
 * Word (.docx) text extraction. Thin wrapper around `mammoth`.
 *
 * Returns the document's raw text (paragraphs joined by newlines).
 * Layout, styling, and tables are flattened — this is for the brain's
 * "what does this document say" recall, not faithful reproduction.
 *
 * Only the modern OOXML `.docx` format is supported. Legacy binary
 * `.doc` is a different (pre-2007) format mammoth can't read — those
 * fall through to the title in the extractor, same as a scanned PDF.
 *
 * Separate entry point (`@mantle/files/docx`) so mammoth is only loaded
 * when a Word doc actually shows up.
 */

import mammoth from 'mammoth';

export async function parseDocx(buf: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: buf });
  return (result.value ?? '').trim();
}
