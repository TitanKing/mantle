/**
 * Build the OpenRouter `messages` array, opting into prompt caching when the
 * upstream model supports it.
 *
 *   - `anthropic/*` models honour `cache_control: { type: 'ephemeral' }` on
 *     content parts; the prefix gets cached for 5 minutes and reused on
 *     subsequent turns at ~10% the cost.
 *   - `openai/*`, `deepseek/*` cache automatically — no marker needed.
 *   - Other models simply ignore the marker; sending it is harmless.
 *
 * v1 caches only the system prompt. A future commit can add a second
 * breakpoint above the last user turn to cache the history prefix as well,
 * once we know the history is stable enough turn-to-turn for cache hits.
 */

export type HistoryTurn = { role: 'user' | 'assistant'; text: string };

type ChatMessage =
  | { role: 'system'; content: string | Array<{ type: 'text'; text: string; cacheControl?: { type: 'ephemeral' } }> }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export function buildChatMessages(
  model: string,
  systemPrompt: string,
  history: HistoryTurn[],
  newUserText: string,
): ChatMessage[] {
  const supportsExplicitCache = model.startsWith('anthropic/');

  const systemMessage: ChatMessage = supportsExplicitCache
    ? {
        role: 'system',
        content: [
          { type: 'text', text: systemPrompt, cacheControl: { type: 'ephemeral' } },
        ],
      }
    : { role: 'system', content: systemPrompt };

  return [
    systemMessage,
    ...history.map((t): ChatMessage =>
      t.role === 'user'
        ? { role: 'user', content: t.text }
        : { role: 'assistant', content: t.text },
    ),
    { role: 'user', content: newUserText },
  ];
}
