import { describe, expect, it } from 'vitest';
import { dominantKind, MIN_MESSAGES_FOR_PILL, parseKindParam } from './dominant-kind';

/**
 * Verifies the JS-side computation of the per-row pill matches the spec's
 * settled thresholds (≥3 messages, ≥70%). The SQL counterpart
 * (`dominantKindWhere`) is exercised end-to-end on /settings/senders;
 * keeping them aligned is a "don't change one without the other"
 * convention we test by hand under the dev DB.
 */

const row = (over: Partial<Parameters<typeof dominantKind>[0]> = {}) => ({
  messageCount: 0,
  directCount: 0,
  listCount: 0,
  automatedCount: 0,
  marketingCount: 0,
  ...over,
});

describe('dominantKind', () => {
  it('returns null below MIN_MESSAGES_FOR_PILL', () => {
    expect(
      dominantKind(row({ messageCount: MIN_MESSAGES_FOR_PILL - 1, marketingCount: 2 })),
    ).toBe(null);
  });

  it('returns marketing when ≥ 70% of messages classify that way', () => {
    expect(dominantKind(row({ messageCount: 10, marketingCount: 7 }))).toBe('marketing');
  });

  it('returns null when no kind crosses the 70% threshold (mixed-use)', () => {
    expect(
      dominantKind(
        row({ messageCount: 10, marketingCount: 4, directCount: 4, automatedCount: 2 }),
      ),
    ).toBe(null);
  });

  it('returns list when list dominates', () => {
    expect(dominantKind(row({ messageCount: 5, listCount: 5 }))).toBe('list');
  });

  it('returns automated when automated dominates', () => {
    expect(dominantKind(row({ messageCount: 5, automatedCount: 5 }))).toBe('automated');
  });

  it('returns direct even though the pill UI hides it (filter still needs the positive)', () => {
    expect(dominantKind(row({ messageCount: 4, directCount: 4 }))).toBe('direct');
  });

  it('threshold is inclusive at exactly 70%', () => {
    // 7 / 10 = 0.7 — the boundary should count as dominant.
    expect(dominantKind(row({ messageCount: 10, marketingCount: 7 }))).toBe('marketing');
  });

  it('priority cascade is marketing → list → automated → direct on the boundary', () => {
    // Pathological: with 0.7 threshold and 10 messages, only one kind can
    // reach 7. So tie-only-on-threshold is impossible — but if it ever
    // were (lower threshold), marketing wins first. Smoke-test the order.
    expect(
      dominantKind(row({ messageCount: 10, marketingCount: 7, listCount: 7 })),
    ).toBe('marketing');
  });
});

describe('parseKindParam', () => {
  it('accepts the four valid kinds', () => {
    expect(parseKindParam('direct')).toBe('direct');
    expect(parseKindParam('list')).toBe('list');
    expect(parseKindParam('automated')).toBe('automated');
    expect(parseKindParam('marketing')).toBe('marketing');
  });

  it('rejects unknown, empty, and undefined', () => {
    expect(parseKindParam('unknown')).toBe(null);
    expect(parseKindParam('')).toBe(null);
    expect(parseKindParam(undefined)).toBe(null);
    expect(parseKindParam('MARKETING')).toBe(null); // case-sensitive on purpose
  });
});
