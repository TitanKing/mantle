/**
 * Model → max-context-window-tokens.
 *
 * The AUTHORITATIVE source is OpenRouter's public `/api/v1/models`
 * response (`top_provider.context_length`), fetched and cached at runtime
 * by {@link refreshContextLimits}. The static map below is only a
 * FALLBACK — used before the first live fetch lands or when OpenRouter is
 * unreachable. Keep it roughly current, but live data always wins.
 *
 * Why live: provider context windows change without notice (e.g. Claude
 * Sonnet/Opus moving to a 1M default), and a hand-maintained table
 * silently goes stale — which made the dashboard's "context %" over-report
 * usage by 5×. The fetch is keyless (the catalog is public), TTL-gated,
 * and fails safe to this table.
 *
 * Values are total context length (input + output).
 */
const FALLBACK_CONTEXT_LIMITS: Record<string, number> = {
  // Anthropic via OpenRouter — 4.x sonnet/opus default to a 1M window.
  'anthropic/claude-haiku-4.5': 200_000,
  'anthropic/claude-sonnet-4.6': 1_000_000,
  'anthropic/claude-opus-4.7': 1_000_000,
  'anthropic/claude-opus-4.7-fast': 1_000_000,

  // OpenAI via OpenRouter
  'openai/gpt-4o': 128_000,
  'openai/gpt-4o-mini': 128_000,
  'openai/gpt-4-turbo': 128_000,
  'openai/o1': 200_000,
  'openai/o1-mini': 128_000,

  // DeepSeek
  'deepseek/deepseek-chat': 64_000,
  'deepseek/deepseek-reasoner': 64_000,

  // Google
  'google/gemini-2.5-flash': 1_000_000,
  'google/gemini-2.5-pro': 2_000_000,

  // xAI
  'x-ai/grok-2': 131_072,
  'x-ai/grok-4': 256_000,
};

/** OpenRouter's public model catalog — no API key required. */
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
/** Re-fetch the live catalog at most this often. */
const CONTEXT_TTL_MS = 6 * 60 * 60 * 1000; // 6h
/** Abort the catalog fetch if it stalls — a context bar must never hang a caller. */
const CONTEXT_FETCH_TIMEOUT_MS = 8_000;

let liveLimits: Record<string, number> | null = null;
let liveFetchedAt = 0;
let inFlight: Promise<void> | null = null;

type OpenRouterModel = {
  id?: string;
  context_length?: number | null;
  top_provider?: { context_length?: number | null } | null;
};

/** Parse the OpenRouter catalog into a slug→context-length map. Prefers
 *  the default route's actual window (`top_provider.context_length`),
 *  falling back to the model-level `context_length`. Exported for unit
 *  testing — production calls it via {@link refreshContextLimits}. */
export function parseCatalog(models: OpenRouterModel[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of models) {
    const id = typeof m.id === 'string' ? m.id.toLowerCase() : '';
    if (!id) continue;
    const top = m.top_provider?.context_length;
    const base = m.context_length;
    const ctx =
      typeof top === 'number' && top > 0
        ? top
        : typeof base === 'number' && base > 0
          ? base
          : 0;
    if (ctx > 0) out[id] = ctx;
  }
  return out;
}

/**
 * Refresh the live context-limit cache from OpenRouter, at most once per
 * TTL. Safe to call on every request: TTL-gated, dedupes concurrent
 * callers, **never throws**, and keeps the last-good cache on failure (so
 * a transient OpenRouter outage degrades to last-known, then to the static
 * fallback). Await it for guaranteed-fresh numbers; fire-and-forget is
 * also fine since the fallback is accurate.
 */
export async function refreshContextLimits(force = false): Promise<void> {
  const fresh = liveLimits && Date.now() - liveFetchedAt < CONTEXT_TTL_MS;
  if (fresh && !force) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch(OPENROUTER_MODELS_URL, {
        signal: AbortSignal.timeout(CONTEXT_FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`openrouter /models ${res.status}`);
      const body = (await res.json()) as { data?: OpenRouterModel[] };
      const parsed = parseCatalog(body.data ?? []);
      // Only replace the cache on a non-empty parse — a malformed/empty
      // response shouldn't wipe good data.
      if (Object.keys(parsed).length > 0) {
        liveLimits = parsed;
        liveFetchedAt = Date.now();
      }
    } catch (err) {
      // Decorative metric — never let a failed refresh break a caller.
      console.error(
        '[model-context] live context-limit refresh failed:',
        err instanceof Error ? err.message : err,
      );
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export type ContextSource = 'live' | 'fallback' | 'unknown';

/** Total context window for a model slug: live OpenRouter data if cached,
 *  else the static fallback, else null. Sync — call
 *  {@link refreshContextLimits} first if you want guaranteed-fresh data. */
export function contextLimitFor(modelSlug: string | null | undefined): number | null {
  if (!modelSlug) return null;
  const key = modelSlug.toLowerCase();
  return liveLimits?.[key] ?? FALLBACK_CONTEXT_LIMITS[key] ?? null;
}

/** Provenance of a slug's limit — for showing the user where it came from. */
export function contextSourceFor(modelSlug: string | null | undefined): ContextSource {
  if (!modelSlug) return 'unknown';
  const key = modelSlug.toLowerCase();
  if (liveLimits?.[key] != null) return 'live';
  if (FALLBACK_CONTEXT_LIMITS[key] != null) return 'fallback';
  return 'unknown';
}

/** Merged slug→limit map (live overrides fallback) for bulk UI use, e.g.
 *  the agents form's per-model readout. */
export function contextLimitMap(): Record<string, number> {
  return { ...FALLBACK_CONTEXT_LIMITS, ...(liveLimits ?? {}) };
}

/** Epoch ms of the last successful live fetch, or null if it hasn't run. */
export function contextLimitsFetchedAt(): number | null {
  return liveFetchedAt || null;
}

/**
 * Whether a model can accept image input directly (multimodal). Used to
 * decide if the responder can be shown a raw image vs. needing a vision
 * worker to transcribe it first. Pattern-based rather than an exact list
 * so new versions of known multimodal families keep working.
 */
export function modelSupportsVision(modelSlug: string | null | undefined): boolean {
  if (!modelSlug) return false;
  const s = modelSlug.toLowerCase();
  // Anthropic Claude 3+ — all current Claude chat models are multimodal.
  if (s.startsWith('anthropic/claude-')) return true;
  // OpenAI 4o / 4.1 / 5 / reasoning families (mini variants included).
  if (/^openai\/(gpt-4o|gpt-4\.1|gpt-5|chatgpt-4o|o1|o3|o4)/.test(s)) return true;
  // Google Gemini — all current models are multimodal.
  if (s.startsWith('google/gemini')) return true;
  // xAI Grok vision-capable lines.
  if (s.startsWith('x-ai/grok-4') || s.includes('grok-2-vision')) return true;
  // Open vision-language variants (Qwen-VL, Llama vision, Pixtral, …).
  if (s.includes('-vl') || s.includes('vision') || s.includes('pixtral')) return true;
  return false;
}

/**
 * Maximum decoded image size (bytes) a model's provider will accept for a
 * single inline image. Used by the vision routing to decide whether to send
 * the raw picture to a vision-capable responder, or fall back to a text
 * transcript when it's too big.
 *
 * Anthropic — including `anthropic/*` routed through OpenRouter to Amazon
 * Bedrock — rejects images over ~5 MB with an opaque `400 "Could not process
 * image"`, which `@openrouter/sdk` then masks as a `ResponseValidationError`.
 * We keep a safety margin under that. OpenAI accepts up to 20 MB. Anything
 * uncatalogued gets the conservative Anthropic limit: a too-low guard merely
 * degrades to the transcript fallback, whereas a too-high one is a hard 500.
 */
export function maxImageBytesFor(modelSlug: string | null | undefined): number {
  const ANTHROPIC_LIMIT = 4_500_000; // ~4.5 MB — under Bedrock's ~5 MB cap
  const OPENAI_LIMIT = 18_000_000; // ~18 MB — under OpenAI's 20 MB cap
  if (!modelSlug) return ANTHROPIC_LIMIT;
  if (modelSlug.toLowerCase().startsWith('openai/')) return OPENAI_LIMIT;
  return ANTHROPIC_LIMIT;
}
