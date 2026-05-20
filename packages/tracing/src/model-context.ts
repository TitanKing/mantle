/**
 * Model → max-context-window-tokens map. Used by the usage widget
 * to compute "context %" — how full a recent turn's prompt was
 * relative to the model's maximum context window.
 *
 * Values are total context length (input + output). Sourced from
 * provider documentation; replace with a daily fetch of OpenRouter's
 * /v1/models response when that lands.
 */

const CONTEXT_LIMITS: Record<string, number> = {
  // Anthropic via OpenRouter
  'anthropic/claude-haiku-4.5': 200_000,
  'anthropic/claude-sonnet-4.6': 200_000,
  'anthropic/claude-opus-4.7': 200_000,
  'anthropic/claude-opus-4.7-fast': 200_000,

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

export function contextLimitFor(modelSlug: string | null | undefined): number | null {
  if (!modelSlug) return null;
  return CONTEXT_LIMITS[modelSlug.toLowerCase()] ?? null;
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
