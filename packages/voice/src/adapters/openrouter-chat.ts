/**
 * OpenRouter chat adapter.
 *
 * Wraps the `@openrouter/sdk` chat completions call in the
 * ChatDispatcher contract so the prod chat path can flow through the
 * adapter registry like every other provider — closing the asymmetry
 * called out in §3.3 footnote ¹ of docs/ai-workers.md.
 *
 * Why the SDK and not a raw fetch:
 *   - OR's SDK already encodes the chat-request zod schema, the usage
 *     response shape (incl. promptTokensDetails for cache hits +
 *     `cost` for actual-charge billing), and the streaming/tool-call
 *     boundary. Re-implementing that surface with `fetch` would be a
 *     ~300 LOC duplication for no real win.
 *   - The SDK type `ChatUsage` carries cache_read / cache_write tokens
 *     directly — we round-trip those onto `ChatResult.cacheReadTokens` /
 *     `cacheWriteTokens` so cost dashboards stay accurate after the
 *     migration off direct SDK calls.
 *
 * Discovery: GET `/api/v1/models` is keyless on OR — we hit it without
 * needing the user's key. Soft-fails to the curated static catalog if
 * the call errors so the worker form still has options.
 *
 * cacheControl translation: OR honours Anthropic-style `cache_control:
 * { type: 'ephemeral' }` markers on content blocks and passes them
 * through to the underlying provider. We emit the same content-block
 * wrap as the anthropic-chat adapter when `opts.cacheControl` is set —
 * non-cache-aware downstream models harmlessly ignore the marker.
 */

import { OpenRouter } from '@openrouter/sdk';
import type {
  ChatCacheControl,
  ChatDispatcher,
  ChatModelInfo,
  ChatOptions,
  ChatResult,
} from './types';
import type { DiscoveryResult } from '../discover';
import {
  OPENROUTER_BASE_URL,
  OPENROUTER_CHAT_MODELS,
} from '../catalogs/openrouter';

/** The SDK's `ChatMessage` union is wider than ours; we only emit the
 *  text-shaped subset. Either content is a plain string or a
 *  single-element array of one text block (with optional cache_control).
 *  Tool messages are out of scope for this adapter — the tool-loop
 *  builds them in its own grammar in 3b. */
type OrChatTextBlock = {
  type: 'text';
  text: string;
  cacheControl?: { type: 'ephemeral' };
};

type OrChatMessage =
  | { role: 'system'; content: string | OrChatTextBlock[] }
  | { role: 'user'; content: string | OrChatTextBlock[] }
  | { role: 'assistant'; content: string };

/** Find the index of the final user-role message — the spot we attach
 *  the lastUserMessage cache marker to (when requested). */
function lastUserIndex(messages: ChatOptions['messages']): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === 'user') return i;
  }
  return -1;
}

/** Convert ChatOptions.messages → OR SDK message shape, applying
 *  cache_control markers when the caller asked for them. */
function buildMessages(
  messages: ChatOptions['messages'],
  cacheControl?: ChatCacheControl,
): OrChatMessage[] {
  const lastUser = cacheControl?.lastUserMessage ? lastUserIndex(messages) : -1;
  return messages.map((m, idx) => {
    if (m.role === 'system') {
      if (cacheControl?.systemPrompt) {
        return {
          role: 'system',
          content: [
            {
              type: 'text',
              text: m.content,
              cacheControl: { type: 'ephemeral' },
            },
          ],
        };
      }
      return { role: 'system', content: m.content };
    }
    if (m.role === 'user') {
      if (idx === lastUser) {
        return {
          role: 'user',
          content: [
            {
              type: 'text',
              text: m.content,
              cacheControl: { type: 'ephemeral' },
            },
          ],
        };
      }
      return { role: 'user', content: m.content };
    }
    // assistant
    return { role: 'assistant', content: m.content };
  });
}

/** Extract the reply text from the OR SDK's chat completion response.
 *  `message.content` can be a plain string OR an array of content
 *  blocks; we walk both and concatenate text parts so callers get a
 *  single string. */
function extractReplyText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object' && 'text' in c) {
          const text = (c as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

async function openrouterChat(opts: ChatOptions): Promise<ChatResult> {
  if (!opts.apiKey) throw new Error('openrouter-chat: apiKey required');
  if (!opts.model) throw new Error('openrouter-chat: model required');

  const client = new OpenRouter({
    apiKey: opts.apiKey,
    // Identifiers OR shows on its dashboard for traffic attribution.
    // Kept consistent with the existing direct-SDK call sites in
    // apps/agent so OR sees the same fingerprint pre- and post-migration.
    httpReferer: 'https://mantle.crossworks.network',
    appTitle: 'Mantle',
  });

  const messages = buildMessages(opts.messages, opts.cacheControl);

  const result = await client.chat.send({
    chatRequest: {
      model: opts.model,
      messages: messages as unknown as Parameters<
        typeof client.chat.send
      >[0]['chatRequest']['messages'],
      ...(typeof opts.temperature === 'number'
        ? { temperature: opts.temperature }
        : {}),
      ...(typeof opts.maxTokens === 'number' ? { maxTokens: opts.maxTokens } : {}),
      ...(typeof opts.topP === 'number' ? { topP: opts.topP } : {}),
      ...(opts.extra ?? {}),
    },
  });
  if (!('choices' in result)) {
    throw new Error(
      'openrouter-chat: unexpected streaming response (no `choices`)',
    );
  }

  const choice = result.choices?.[0];
  const text = extractReplyText(choice?.message).trim();
  const usage = result.usage;
  // The SDK's `cost` field is a USD number when OR reports it (always
  // for routes where OR has direct billing visibility). We expose it
  // verbatim — the trace recorder converts to micro-USD and prefers
  // this over the static price table.
  const reportedCostUsd =
    usage?.cost != null && Number.isFinite(usage.cost) ? usage.cost : undefined;

  return {
    text,
    model: (result as { model?: string }).model || opts.model,
    tokensIn: usage?.promptTokens,
    tokensOut: usage?.completionTokens,
    cacheReadTokens: usage?.promptTokensDetails?.cachedTokens ?? undefined,
    cacheWriteTokens: usage?.promptTokensDetails?.cacheWriteTokens ?? undefined,
    reportedCostUsd,
  };
}

type OrListModelsResponse = {
  data?: Array<{
    id: string;
    name?: string;
    description?: string;
    context_length?: number;
    top_provider?: { context_length?: number };
    pricing?: { prompt?: string; completion?: string };
    architecture?: { modality?: string; input_modalities?: string[] };
  }>;
};

/** Decimal-string price → USD per 1M tokens. OR's pricing fields are
 *  per-token strings ("0.000003"). Multiply by 1M and round to 4dp
 *  for display. */
function perMillion(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 1_000_000 * 10_000) / 10_000;
}

async function openrouterDiscover(
  _apiKey: string,
): Promise<DiscoveryResult<ChatModelInfo>> {
  // OR's /api/v1/models is keyless — we don't need the user's key
  // (the underscore on the param). We pass it anyway in case OR ever
  // starts gating; sending an Authorization header against a keyless
  // endpoint is a no-op.
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      headers: _apiKey ? { Authorization: `Bearer ${_apiKey}` } : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        available: [...OPENROUTER_CHAT_MODELS],
        filtered: false,
        error: `openrouter /v1/models ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const parsed = (await res.json()) as OrListModelsResponse;
    const models = parsed.data ?? [];
    // Filter to chat-shaped models (drop embeddings, image-gen). OR's
    // catalog has a modality field on architecture; presence of
    // 'text' input + 'text' output = chat.
    const chatModels: ChatModelInfo[] = models
      .filter((m) => {
        const inputs = m.architecture?.input_modalities ?? [];
        // If no modality info, assume chat (most entries are chat).
        if (inputs.length === 0) return true;
        return inputs.includes('text');
      })
      // Skip image-output-only routes (they live in the kind='image' bucket).
      .filter((m) => !/(image|stable-diffusion|flux|dall-e)/i.test(m.id))
      .map((m) => ({
        id: m.id,
        label: m.name || m.id,
        description: m.description || `OpenRouter route: ${m.id}`,
        contextTokens: m.top_provider?.context_length ?? m.context_length,
        inputPricePer1M: perMillion(m.pricing?.prompt),
        outputPricePer1M: perMillion(m.pricing?.completion),
      }));
    return {
      // Discovery returned the live list — that's the authoritative
      // answer. Fall back to the static catalog only when discovery
      // somehow returned zero (network glitch the response status
      // didn't catch).
      available: chatModels.length > 0 ? chatModels : [...OPENROUTER_CHAT_MODELS],
      filtered: chatModels.length > 0,
      error: null,
    };
  } catch (err) {
    return {
      available: [...OPENROUTER_CHAT_MODELS],
      filtered: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const openrouterChatAdapter: ChatDispatcher = {
  providerId: 'openrouter',
  adapterName: 'openrouter-chat',
  chat: openrouterChat,
  discoverModels: openrouterDiscover,
  staticCatalog: () => OPENROUTER_CHAT_MODELS,
};
