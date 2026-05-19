/**
 * Builtin tools that delegate to ai_workers — the bridge between
 * Saskia's conversational agency and the modality-specific workers
 * (TTS, vision, summarizer).
 *
 * Design notes:
 *
 * 1. Modality-matched automatic pipelines still run as before
 *    (voice-in → voice-out, photo → vision ingest). These tools are
 *    for cases where the *model* decides to invoke a worker on its
 *    own initiative — e.g. "send that as a voice note", "look at the
 *    photo I sent yesterday again", "give me a TLDR of that note".
 *
 * 2. Each tool resolves the OWNER'S DEFAULT worker for its capability
 *    via getDefaultWorker(ownerId, kind). If no default exists or
 *    the worker is misconfigured, the tool returns a structured
 *    `{ok: false, error: '...'}` rather than throwing — the LLM sees
 *    the error and tells the user conversationally ("I'd love to,
 *    but you haven't set up a TTS worker yet").
 *
 * 3. `synthesize_speech` is the only one with a side effect on the
 *    outbound channel — it calls Telegram's sendVoice directly. It
 *    refuses on the web /assistant surface with a clear "Telegram
 *    only" message so the LLM falls back to a text reply.
 *
 * 4. `extract_from_image` and `summarize_text` are pure return-value
 *    tools: they hand back extracted/summarized text the LLM can
 *    then weave into its reply.
 */

import { and, eq } from 'drizzle-orm';
import { db, nodes, getDefaultWorker, type AiWorkerKind } from '@mantle/db';
import { getApiKeyById } from '@mantle/api-keys';
import { accountForChat, downloadTelegramFile, sendVoice } from '@mantle/telegram';
import { fileById, readFileById } from '@mantle/files';
import {
  getChatAdapter,
  getTtsAdapter,
  getVisionAdapter,
} from '@mantle/voice';
import type { BuiltinToolDef, ToolHandlerContext, ToolHandlerResult } from './types';

// ─── shared helpers ────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function strOpt(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function num(v: unknown, dflt?: number): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return dflt;
}

/**
 * Resolve `{worker, apiKey}` for a default worker of the given kind,
 * or return a structured error the tool can pass straight back to the
 * LLM. Centralised so every worker tool reports the same shape of
 * "not configured" message.
 */
async function resolveDefaultWorker(
  ownerId: string,
  kind: AiWorkerKind,
): Promise<
  | { ok: true; worker: NonNullable<Awaited<ReturnType<typeof getDefaultWorker>>>; apiKey: string }
  | { ok: false; error: string }
> {
  const worker = await getDefaultWorker(ownerId, kind);
  if (!worker) {
    return {
      ok: false,
      error: `No default ${kind} worker configured. Create one at /settings/ai-workers and mark it default.`,
    };
  }
  if (!worker.apiKeyId) {
    return {
      ok: false,
      error: `The default ${kind} worker '${worker.slug}' has no api_key attached. Edit it at /settings/ai-workers.`,
    };
  }
  const apiKey = await getApiKeyById(worker.apiKeyId);
  if (!apiKey) {
    return {
      ok: false,
      error: `The api_key for ${kind} worker '${worker.slug}' could not be decrypted. Check /settings/api-keys.`,
    };
  }
  return { ok: true, worker, apiKey };
}

// ─── synthesize_speech ─────────────────────────────────────────────

const synthesize_speech: BuiltinToolDef = {
  slug: 'synthesize_speech',
  name: 'Send a voice reply',
  description:
    "Synthesize text-to-speech using the owner's default TTS worker and send it as a Telegram voice note. Use ONLY when the user explicitly asks for audio ('send me a voice note', 'read that aloud', etc.), or when a long answer would land better as a voice reply on mobile. After calling, write a brief text follow-up ('Sent you a voice note.') — don't repeat the spoken content. Refuses on the /assistant web surface — that channel is text-only.",
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        description:
          "The text to speak. Up to ~15k characters for xAI / 4k for OpenAI; the adapter trims if needed. Inline audio tags ([laughs], [whispers], etc.) work on TTS models that support them; check the worker's tag hint in the form.",
      },
      voice: {
        type: 'string',
        description:
          'Optional voice id override. Defaults to the worker\'s configured voice. Use ONLY when the user names a specific voice — otherwise omit.',
      },
    },
    required: ['text'],
  },
  handler: async (input, ctx): Promise<ToolHandlerResult> => {
    const text = str(input.text).trim();
    if (!text) return { ok: false, error: 'text required' };

    if (!ctx.surface || ctx.surface.kind !== 'telegram') {
      return {
        ok: false,
        error:
          ctx.surface?.kind === 'web'
            ? 'synthesize_speech only works on Telegram. Reply in text instead.'
            : 'synthesize_speech requires a Telegram chat context.',
      };
    }
    const resolved = await resolveDefaultWorker(ctx.ownerId, 'tts');
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const { worker, apiKey } = resolved;

    const adapter = getTtsAdapter(worker.provider);
    if (!adapter) {
      return {
        ok: false,
        error: `No TTS adapter wired for provider '${worker.provider}'. Switch the default TTS worker to openai / elevenlabs / xai / google.`,
      };
    }
    const params = (worker.params ?? {}) as {
      voice?: string;
      speed?: number;
      instructions?: string;
      language?: string;
    };
    const voiceId = strOpt(input.voice) ?? params.voice ?? 'nova';

    try {
      const synth = await adapter.synthesize({
        apiKey,
        text,
        // Cast through unknown: TtsVoice is OpenAI-shaped at the type
        // layer but at runtime adapters accept arbitrary strings (xAI
        // custom voice ids, ElevenLabs voice ids, …).
        voice: voiceId as unknown as never,
        model: worker.model,
        speed: params.speed ?? 1.0,
        // Telegram-native — sendVoice renders as a voice-bubble.
        format: 'opus',
        instructions: params.instructions,
        language: params.language,
      });
      const account = await accountForChat(ctx.surface.telegramChatId);
      if (!account) {
        return {
          ok: false,
          error: `No Telegram account configured for chat ${ctx.surface.telegramChatId}.`,
        };
      }
      const tgMsgId = await sendVoice(account, ctx.surface.telegramChatId, synth.bytes, {
        replyTo: ctx.surface.replyToTelegramMessageId,
      });
      ctx.step?.setMeta({
        adapter: adapter.adapterName,
        bytes: synth.bytes.length,
        voice: voiceId,
        worker_slug: worker.slug,
      });
      return {
        ok: true,
        output: {
          sent: true,
          telegramMessageId: tgMsgId,
          voice: voiceId,
          model: synth.model,
          bytes: synth.bytes.length,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── extract_from_image ────────────────────────────────────────────

const extract_from_image: BuiltinToolDef = {
  slug: 'extract_from_image',
  name: 'Read text from an image',
  description:
    "Run the owner's default vision worker over an image and return the extracted text. Use when the user asks to re-read a previously-sent photo, OCR a file in their notes, or extract content from a specific image they reference. For photos that JUST arrived in this conversation, the agent's auto-ingest pipeline has already saved the transcript as a note — search_nodes for it before re-extracting.",
  inputSchema: {
    type: 'object',
    properties: {
      node_id: {
        type: 'string',
        description:
          "A node id pointing to a file row whose stored object is an image. Use this for previously-uploaded images.",
      },
      telegram_file_id: {
        type: 'string',
        description:
          "A Telegram file_id (from message attachments). Only useful inside a Telegram turn — refuses on the web surface.",
      },
      prompt: {
        type: 'string',
        description:
          "Optional override for the worker's configured extraction prompt. Defaults to verbatim transcription.",
      },
    },
  },
  handler: async (input, ctx): Promise<ToolHandlerResult> => {
    const nodeId = strOpt(input.node_id);
    const telegramFileId = strOpt(input.telegram_file_id);
    if (!nodeId && !telegramFileId) {
      return { ok: false, error: 'Provide either node_id or telegram_file_id.' };
    }
    if (nodeId && telegramFileId) {
      return { ok: false, error: 'Provide only one of node_id / telegram_file_id, not both.' };
    }

    const resolved = await resolveDefaultWorker(ctx.ownerId, 'vision');
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const { worker, apiKey } = resolved;
    const adapter = getVisionAdapter(worker.provider);
    if (!adapter) {
      return {
        ok: false,
        error: `No vision adapter wired for '${worker.provider}'. Switch to openai / anthropic / google / xai.`,
      };
    }

    // ── resolve image bytes ──
    let bytes: Buffer;
    let mimeType: string;
    if (nodeId) {
      const file = await fileById({ ownerId: ctx.ownerId, fileId: nodeId });
      if (!file) return { ok: false, error: `Node ${nodeId} not found or not owned by you.` };
      const mime = file.mimeType ?? 'application/octet-stream';
      if (!mime.startsWith('image/')) {
        return { ok: false, error: `Node ${nodeId} is ${mime}, not an image.` };
      }
      const fetched = await readFileById({ ownerId: ctx.ownerId, fileId: nodeId });
      if (!fetched) {
        return { ok: false, error: `Couldn't read file ${nodeId} from storage.` };
      }
      bytes = fetched.bytes;
      mimeType = mime;
    } else {
      // telegram_file_id path
      if (!ctx.surface || ctx.surface.kind !== 'telegram') {
        return {
          ok: false,
          error: 'telegram_file_id only works inside a Telegram turn. Use node_id instead.',
        };
      }
      const account = await accountForChat(ctx.surface.telegramChatId);
      if (!account) {
        return {
          ok: false,
          error: `No Telegram account for chat ${ctx.surface.telegramChatId}.`,
        };
      }
      try {
        const downloaded = await downloadTelegramFile(account, telegramFileId!);
        bytes = downloaded.bytes;
        mimeType = downloaded.mimeType;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // ── extract ──
    const params = (worker.params ?? {}) as {
      extraction_prompt?: string;
      max_tokens?: number;
    };
    const prompt =
      strOpt(input.prompt) ??
      params.extraction_prompt?.trim() ??
      'Transcribe everything visible in this image verbatim, preserving line breaks and structure. If something is unclear, mark it [unclear]. Output plain text only.';

    try {
      const result = await adapter.extract(bytes, {
        apiKey,
        mimeType,
        prompt,
        systemPrompt: worker.systemPrompt ?? undefined,
        model: worker.model,
        maxTokens: params.max_tokens ?? 2000,
      });
      ctx.step?.setMeta({
        adapter: adapter.adapterName,
        worker_slug: worker.slug,
        bytes: bytes.length,
        text_length: result.text.length,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
      });
      return {
        ok: true,
        output: {
          text: result.text,
          model: result.model,
          adapter: adapter.adapterName,
          tokens: { in: result.tokensIn ?? null, out: result.tokensOut ?? null },
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── summarize_text ────────────────────────────────────────────────

const summarize_text: BuiltinToolDef = {
  slug: 'summarize_text',
  name: 'Summarize a note or block of text',
  description:
    "Run the owner's default summarizer worker (a chat-shaped worker tuned for compression) over text — either inline content or a note's body. Use when the user asks for a TLDR, a recap of a long note, or a digest of something they pasted. For automatic chat-history summarization, the background summarizer already runs; don't call this for that.",
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description:
          'Inline text to summarize. Provide this OR node_id, not both.',
      },
      node_id: {
        type: 'string',
        description: "Id of a note node — the note body is fetched and summarized.",
      },
      focus: {
        type: 'string',
        description:
          'Optional steering for the summary (e.g. "action items only", "key decisions", "what changed"). Defaults to a neutral overview.',
      },
      max_words: {
        type: 'integer',
        description: 'Soft cap on summary length. Default 200.',
      },
    },
  },
  handler: async (input, ctx): Promise<ToolHandlerResult> => {
    const inlineText = strOpt(input.text);
    const nodeId = strOpt(input.node_id);
    if (!inlineText && !nodeId) {
      return { ok: false, error: 'Provide either text or node_id.' };
    }
    if (inlineText && nodeId) {
      return { ok: false, error: 'Provide only one of text / node_id, not both.' };
    }

    // Resolve source text.
    let source: string;
    if (nodeId) {
      const [row] = await db
        .select({ data: nodes.data, type: nodes.type, title: nodes.title })
        .from(nodes)
        .where(and(eq(nodes.id, nodeId), eq(nodes.ownerId, ctx.ownerId)))
        .limit(1);
      if (!row) return { ok: false, error: `Node ${nodeId} not found or not owned by you.` };
      const content = (row.data as { content?: string } | null)?.content ?? '';
      if (!content.trim()) {
        return { ok: false, error: `Node ${nodeId} has no content to summarize.` };
      }
      source = content;
    } else {
      source = inlineText!;
    }

    const resolved = await resolveDefaultWorker(ctx.ownerId, 'summarizer');
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const { worker, apiKey } = resolved;
    // Summarizer is chat-shaped — invoke through the chat adapter for
    // the worker's provider. OpenRouter-routed summarizers aren't
    // wired through this path today; if the provider isn't in the
    // chat-adapter registry we tell the user.
    const adapter = getChatAdapter(worker.provider);
    if (!adapter) {
      return {
        ok: false,
        error: `Summarizer worker uses provider '${worker.provider}', which isn't wired as a chat adapter. Switch to xai / huggingface / anthropic / google.`,
      };
    }

    const focus = strOpt(input.focus);
    const maxWords = num(input.max_words, 200) ?? 200;
    const systemPrompt =
      worker.systemPrompt?.trim() ||
      `You are a precise summarizer. Output a clean ${maxWords}-word summary in the same language as the source. No preamble, no closing remarks — just the summary.`;
    const userPrompt = focus
      ? `${source}\n\n---\n\nFocus the summary on: ${focus}`
      : source;

    const params = (worker.params ?? {}) as {
      temperature?: number;
      max_tokens?: number;
    };
    try {
      const result = await adapter.chat({
        apiKey,
        model: worker.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: params.temperature ?? 0.3,
        maxTokens: params.max_tokens ?? Math.max(maxWords * 4, 600),
      });
      ctx.step?.setMeta({
        adapter: adapter.adapterName,
        worker_slug: worker.slug,
        source_length: source.length,
        summary_length: result.text.length,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
      });
      return {
        ok: true,
        output: {
          summary: result.text,
          model: result.model,
          adapter: adapter.adapterName,
          tokens: { in: result.tokensIn ?? null, out: result.tokensOut ?? null },
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const WORKER_DELEGATION_TOOLS: readonly BuiltinToolDef[] = [
  synthesize_speech,
  extract_from_image,
  summarize_text,
];
