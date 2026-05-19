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
