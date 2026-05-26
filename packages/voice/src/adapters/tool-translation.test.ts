/**
 * Lock down the tool-call translation each chat adapter performs.
 *
 * The runtime emits a single normalised shape — `ChatToolDefinition` on
 * the way in, `ChatToolCall` on the way out, `tool` role messages for
 * results. Each adapter translates to/from its provider's native shape:
 *
 *   - openrouter-chat / xai-chat / huggingface-chat: OpenAI-compat,
 *     mostly pass-through with role-name conventions.
 *   - anthropic-chat: tool_use / tool_result content blocks; tool
 *     results travel as user-role messages (Anthropic models tool
 *     results conceptually as user-fed-back).
 *   - google-chat: functionCall / functionResponse parts on contents;
 *     ids are synthesised on the way in.
 *
 * These tests assert the WIRE shape each adapter actually emits + the
 * normalisation it does on the response. Together with chat-adapters.
 * test.ts (registration + catalog), this is the safety net for the
 * tool-loop refactor.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  anthropicChatAdapter,
  googleChatAdapter,
  xaiChatAdapter,
} from './index';
import type { ChatToolDefinition } from './types';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function captureFetch(response: unknown) {
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? '') });
    return { ok: true, json: async () => response };
  }) as unknown as typeof fetch;
  return calls;
}

const SAMPLE_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'note_create',
    description: 'Create a note in the brain',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['title', 'content'],
    },
  },
};

// ─── anthropic-chat ─────────────────────────────────────────────────────────

describe('anthropic-chat tool translation', () => {
  it('sends tools as Anthropic-shape (name + description + input_schema)', async () => {
    const calls = captureFetch({
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-haiku-4-5',
      usage: {},
    });
    await anthropicChatAdapter.chat({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'make a note' }],
      tools: [SAMPLE_TOOL],
    });
    const body = JSON.parse(calls[0]!.body);
    expect(body.tools).toEqual([
      {
        name: 'note_create',
        description: 'Create a note in the brain',
        input_schema: SAMPLE_TOOL.function.parameters,
      },
    ]);
  });

  it('extracts tool_use blocks from the response as ChatToolCall', async () => {
    captureFetch({
      content: [
        { type: 'text', text: "I'll create that note." },
        {
          type: 'tool_use',
          id: 'toolu_abc123',
          name: 'note_create',
          input: { title: 'Hello', content: 'World' },
        },
      ],
      model: 'claude-haiku-4-5',
      stop_reason: 'tool_use',
      usage: { input_tokens: 50, output_tokens: 30 },
    });
    const result = await anthropicChatAdapter.chat({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'make a note' }],
      tools: [SAMPLE_TOOL],
    });
    expect(result.toolCalls).toEqual([
      {
        id: 'toolu_abc123',
        type: 'function',
        function: {
          name: 'note_create',
          arguments: JSON.stringify({ title: 'Hello', content: 'World' }),
        },
      },
    ]);
    expect(result.text).toBe("I'll create that note.");
  });

  it('translates assistant.toolCalls back to assistant content blocks with tool_use', async () => {
    const calls = captureFetch({
      content: [{ type: 'text', text: 'done' }],
      model: 'claude-haiku-4-5',
      usage: {},
    });
    await anthropicChatAdapter.chat({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'user', content: 'do it' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'toolu_xyz',
              type: 'function',
              function: {
                name: 'note_create',
                arguments: '{"title":"hi","content":"there"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'toolu_xyz',
          content: '{"id":"node_123"}',
        },
      ],
    });
    const body = JSON.parse(calls[0]!.body);
    // assistant turn: content array with one tool_use block (no text block
    // since content was null/empty).
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_xyz',
          name: 'note_create',
          input: { title: 'hi', content: 'there' },
        },
      ],
    });
    // tool turn → user message with tool_result block.
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_xyz',
          content: '{"id":"node_123"}',
        },
      ],
    });
  });

  it('coalesces consecutive tool messages into a single user message with multiple tool_result blocks', async () => {
    const calls = captureFetch({
      content: [{ type: 'text', text: 'done' }],
      model: 'claude-haiku-4-5',
      usage: {},
    });
    await anthropicChatAdapter.chat({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'user', content: 'do two things' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            { id: 'toolu_1', type: 'function', function: { name: 'a', arguments: '{}' } },
            { id: 'toolu_2', type: 'function', function: { name: 'b', arguments: '{}' } },
          ],
        },
        { role: 'tool', toolCallId: 'toolu_1', content: 'res-a' },
        { role: 'tool', toolCallId: 'toolu_2', content: 'res-b' },
      ],
    });
    const body = JSON.parse(calls[0]!.body);
    // The two tool messages coalesce into one user message with two
    // tool_result blocks (Anthropic's preferred shape).
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'res-a' },
        { type: 'tool_result', tool_use_id: 'toolu_2', content: 'res-b' },
      ],
    });
  });

  it('drops the tools field when toolChoice is "none"', async () => {
    const calls = captureFetch({
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-haiku-4-5',
      usage: {},
    });
    await anthropicChatAdapter.chat({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'just answer' }],
      tools: [SAMPLE_TOOL],
      toolChoice: 'none',
    });
    const body = JSON.parse(calls[0]!.body);
    expect(body.tools).toBeUndefined();
  });
});

// ─── google-chat ────────────────────────────────────────────────────────────

describe('google-chat tool translation', () => {
  it('sends tools as Gemini-shape (functionDeclarations array)', async () => {
    const calls = captureFetch({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: {},
      modelVersion: 'gemini-2.5-flash',
    });
    await googleChatAdapter.chat({
      apiKey: 'gk-test',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'make a note' }],
      tools: [SAMPLE_TOOL],
    });
    const body = JSON.parse(calls[0]!.body);
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'note_create',
            description: 'Create a note in the brain',
            parameters: SAMPLE_TOOL.function.parameters,
          },
        ],
      },
    ]);
  });

  it('extracts functionCall parts as ChatToolCall (with synthesised id)', async () => {
    captureFetch({
      candidates: [
        {
          content: {
            parts: [
              { text: "I'll do that." },
              {
                functionCall: {
                  name: 'note_create',
                  args: { title: 'g', content: 'h' },
                },
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
      modelVersion: 'gemini-2.5-flash',
    });
    const result = await googleChatAdapter.chat({
      apiKey: 'gk-test',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'make a note' }],
      tools: [SAMPLE_TOOL],
    });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0]?.function).toEqual({
      name: 'note_create',
      arguments: JSON.stringify({ title: 'g', content: 'h' }),
    });
    // The id is synthesised since Gemini doesn't carry one — must be
    // non-empty and stable across the same response.
    expect(result.toolCalls?.[0]?.id).toMatch(/^gemini_call_/);
  });

  it('translates a tool result back to a user message with functionResponse', async () => {
    const calls = captureFetch({
      candidates: [{ content: { parts: [{ text: 'thanks' }] } }],
      usageMetadata: {},
      modelVersion: 'gemini-2.5-flash',
    });
    await googleChatAdapter.chat({
      apiKey: 'gk-test',
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'user', content: 'do it' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'gemini_call_1',
              type: 'function',
              function: { name: 'note_create', arguments: '{"title":"hi"}' },
            },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'gemini_call_1',
          content: '{"node_id":"node_42"}',
        },
      ],
    });
    const body = JSON.parse(calls[0]!.body);
    // model turn carries the functionCall part
    expect(body.contents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'note_create', args: { title: 'hi' } } }],
    });
    // tool result → user turn with functionResponse (name resolved via id map)
    expect(body.contents[2]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'note_create',
            response: { node_id: 'node_42' },
          },
        },
      ],
    });
  });

  it('disables tool calling when toolChoice is "none" (toolConfig.functionCallingConfig.mode = NONE)', async () => {
    const calls = captureFetch({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: {},
      modelVersion: 'gemini-2.5-flash',
    });
    await googleChatAdapter.chat({
      apiKey: 'gk-test',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'just answer' }],
      tools: [SAMPLE_TOOL],
      toolChoice: 'none',
    });
    const body = JSON.parse(calls[0]!.body);
    expect(body.toolConfig).toEqual({
      functionCallingConfig: { mode: 'NONE' },
    });
  });
});

// ─── xai-chat (OpenAI-compat) ───────────────────────────────────────────────

describe('xai-chat tool translation', () => {
  it('forwards tools verbatim and extracts OpenAI-shape tool_calls', async () => {
    captureFetch({
      model: 'grok-4.3',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_x1',
                type: 'function',
                function: {
                  name: 'note_create',
                  arguments: '{"title":"x","content":"y"}',
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 30, completion_tokens: 10 },
    });
    const result = await xaiChatAdapter.chat({
      apiKey: 'xai-test',
      model: 'grok-4.3',
      messages: [{ role: 'user', content: 'do it' }],
      tools: [SAMPLE_TOOL],
    });
    expect(result.toolCalls).toEqual([
      {
        id: 'call_x1',
        type: 'function',
        function: {
          name: 'note_create',
          arguments: '{"title":"x","content":"y"}',
        },
      },
    ]);
  });

  it('translates tool messages to OpenAI tool role with tool_call_id', async () => {
    const calls = captureFetch({
      model: 'grok-4.3',
      choices: [{ message: { role: 'assistant', content: 'done' } }],
      usage: {},
    });
    await xaiChatAdapter.chat({
      apiKey: 'xai-test',
      model: 'grok-4.3',
      messages: [
        { role: 'user', content: 'do it' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'call_x1',
              type: 'function',
              function: { name: 'note_create', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', toolCallId: 'call_x1', content: '{"ok":true}' },
      ],
    });
    const body = JSON.parse(calls[0]!.body);
    expect(body.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_x1',
      content: '{"ok":true}',
    });
  });
});
