/**
 * Theme-token background tints for table cells. We store the TOKEN KEY (e.g.
 * `chart-2`), never a raw colour, so cell shading tracks the active theme +
 * light/dark like the rest of the document — the same discipline as the
 * callout/column tints. Shared by the editor schema (renderHTML) and the public
 * renderer so a shaded cell looks identical in both. Pure (no React) → safe to
 * import server-side.
 */
export const CELL_BG_TOKENS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'muted'] as const;
export type CellBgToken = (typeof CELL_BG_TOKENS)[number];

export function isCellBgToken(v: unknown): v is CellBgToken {
  return typeof v === 'string' && (CELL_BG_TOKENS as readonly string[]).includes(v);
}

/** CSS `background-color` for a token, or null if unknown. `muted` is a
 *  near-solid neutral; the chart tints stay translucent so text remains
 *  readable on any theme. */
export function cellBgColor(token: unknown): string | null {
  if (!isCellBgToken(token)) return null;
  const pct = token === 'muted' ? 55 : 18;
  return `color-mix(in oklab, var(--${token}) ${pct}%, transparent)`;
}
