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
 * Two cache breakpoints when digests are present:
 *   1. system prompt — stable forever
 *   2. digest block  — stable until a new digest lands (every ~20 turns)
 * Only the raw-history tail + new user message change turn-to-turn, so the
 * first ~2/3 of the prompt is cache-eligible.
 *
 * Anthropic allows up to 4 breakpoints; we're using 2 here, leaving headroom
 * for a future "stable history prefix" breakpoint.
 */

export type HistoryTurn = { role: 'user' | 'assistant'; text: string };

export type Digest = {
  summary: string;
  periodStart: string;
  periodEnd: string;
};

type ChatMessage =
  | {
      role: 'system';
      content:
        | string
        | Array<{ type: 'text'; text: string; cacheControl?: { type: 'ephemeral' } }>;
    }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export function buildChatMessages(
  model: string,
  systemPrompt: string,
  digests: Digest[],
  history: HistoryTurn[],
  newUserText: string,
): ChatMessage[] {
  const supportsExplicitCache = model.startsWith('anthropic/');
  const ephemeral = { type: 'ephemeral' as const };

  const systemMessage: ChatMessage = supportsExplicitCache
    ? {
        role: 'system',
        content: [{ type: 'text', text: systemPrompt, cacheControl: ephemeral }],
      }
    : { role: 'system', content: systemPrompt };

  const messages: ChatMessage[] = [systemMessage];

  if (digests.length > 0) {
    const body = digests
      .map((d) => `[${d.periodStart} → ${d.periodEnd}] ${d.summary}`)
      .join('\n\n');
    const digestText = `Earlier in this conversation (summarised):\n\n${body}`;
    messages.push(
      supportsExplicitCache
        ? {
            role: 'system',
            content: [{ type: 'text', text: digestText, cacheControl: ephemeral }],
          }
        : { role: 'system', content: digestText },
    );
  }

  messages.push(
    ...history.map((t): ChatMessage =>
      t.role === 'user'
        ? { role: 'user', content: t.text }
        : { role: 'assistant', content: t.text },
    ),
    { role: 'user', content: newUserText },
  );

  return messages;
}
