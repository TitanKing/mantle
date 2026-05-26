/**
 * Tests for the pure helpers inside the IMAP provider.
 *
 * The IMAP integration itself — fetching, folder discovery, envelope
 * normalisation against a real Gmail / Fastmail server — is verified live
 * during sync (see docs/email-ingest.md §10). This file covers the
 * deterministic helpers that decide what we store, where every byte of
 * input variance has to land in the same canonical place:
 *
 *   - `normalizeRfcMessageId` — the cross-folder dedup key
 *     (`(account_id, rfc_message_id)` partial unique index, migration 0045).
 *     If two IMAP servers return the same logical Message-ID differently
 *     wrapped (one with angle brackets, one without; one with surrounding
 *     whitespace, one bare), the dedup MUST collapse them — otherwise we'd
 *     get the same message indexed twice depending on which folder it was
 *     pulled from.
 */

import { describe, expect, it } from 'vitest';
import { normalizeRfcMessageId } from './imap';

describe('normalizeRfcMessageId', () => {
  it('strips surrounding angle brackets (the common IMAP envelope shape)', () => {
    expect(normalizeRfcMessageId('<abc123@gmail.com>')).toBe('abc123@gmail.com');
  });

  it('returns a bare id unchanged (some servers strip the brackets themselves)', () => {
    expect(normalizeRfcMessageId('abc123@gmail.com')).toBe('abc123@gmail.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeRfcMessageId('  <abc@x.com>  ')).toBe('abc@x.com');
    expect(normalizeRfcMessageId('\n<abc@x.com>\t')).toBe('abc@x.com');
  });

  it('handles undefined / null / empty input by returning undefined', () => {
    expect(normalizeRfcMessageId(undefined)).toBeUndefined();
    expect(normalizeRfcMessageId(null)).toBeUndefined();
    expect(normalizeRfcMessageId('')).toBeUndefined();
  });

  it('treats brackets-only / whitespace-only input as no id', () => {
    expect(normalizeRfcMessageId('<>')).toBeUndefined();
    expect(normalizeRfcMessageId('   ')).toBeUndefined();
    expect(normalizeRfcMessageId('<   >')).toBeUndefined();
  });

  it("preserves the id even if it contains characters that look bracket-ish but aren't at the ends", () => {
    // Real-world Message-IDs occasionally embed <…> inside the id (rare but
    // legal). Make sure we only peel the OUTER pair, not anything inner.
    expect(normalizeRfcMessageId('<foo<bar>baz@host>')).toBe('foo<bar>baz@host');
  });

  it('strips only one leading < and one trailing > (not nested layers)', () => {
    // Defensive: a malformed double-wrapped id keeps its inner brackets.
    expect(normalizeRfcMessageId('<<abc@host>>')).toBe('<abc@host>');
  });

  it('cross-folder canonicalisation: same id with/without brackets dedups to the same value', () => {
    // This is the key invariant the partial unique index relies on. If a
    // message arrives once in INBOX as `<abc@x>` and once in [Gmail]/All
    // Mail as `abc@x`, both must normalise to the same string so the
    // (account_id, rfc_message_id) constraint catches the second insert.
    const fromInbox = normalizeRfcMessageId('<abc@x.com>');
    const fromAllMail = normalizeRfcMessageId('abc@x.com');
    const withTrailingSpace = normalizeRfcMessageId('<abc@x.com> ');
    expect(fromInbox).toBe(fromAllMail);
    expect(fromInbox).toBe(withTrailingSpace);
  });
});
