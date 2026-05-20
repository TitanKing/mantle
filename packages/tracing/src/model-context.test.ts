/**
 * Tests for the vision routing helpers used by the web /assistant and the
 * Telegram responder to decide whether to show a model a raw image.
 *
 * Why these matter: `maxImageBytesFor` is the size guard that keeps an
 * oversized photo from reaching Anthropic-via-Bedrock, which rejects images
 * over ~5 MB with an opaque "Could not process image" that the OpenRouter
 * SDK masks as a generic validation error → a hard 500 on the turn. Locking
 * the limits down here keeps that guard honest. `modelSupportsVision` gates
 * the same decision, so a regression in its family matching would silently
 * stop sending pictures (or send them to a text-only model).
 */

import { describe, expect, it } from 'vitest';
import { maxImageBytesFor, modelSupportsVision } from './model-context';

describe('maxImageBytesFor', () => {
  it('keeps Anthropic under Bedrock\'s ~5 MB per-image cap', () => {
    expect(maxImageBytesFor('anthropic/claude-sonnet-4.6')).toBeLessThan(5_000_000);
    expect(maxImageBytesFor('anthropic/claude-opus-4.7')).toBe(4_500_000);
  });

  it('allows OpenAI a larger budget but stays under its 20 MB cap', () => {
    const limit = maxImageBytesFor('openai/gpt-4o');
    expect(limit).toBeGreaterThan(5_000_000);
    expect(limit).toBeLessThan(20_000_000);
  });

  it('falls back to the conservative Anthropic limit for unknown / null models', () => {
    expect(maxImageBytesFor('google/gemini-2.5-pro')).toBe(4_500_000);
    expect(maxImageBytesFor('some/unlisted-model')).toBe(4_500_000);
    expect(maxImageBytesFor(null)).toBe(4_500_000);
    expect(maxImageBytesFor(undefined)).toBe(4_500_000);
  });
});

describe('modelSupportsVision', () => {
  it('recognises the multimodal families the responder runs', () => {
    expect(modelSupportsVision('anthropic/claude-sonnet-4.6')).toBe(true);
    expect(modelSupportsVision('openai/gpt-4o-mini')).toBe(true);
    expect(modelSupportsVision('google/gemini-2.5-flash')).toBe(true);
    expect(modelSupportsVision('x-ai/grok-4')).toBe(true);
    expect(modelSupportsVision('mistralai/pixtral-12b')).toBe(true);
  });

  it('rejects text-only models and empty input', () => {
    expect(modelSupportsVision('deepseek/deepseek-chat')).toBe(false);
    expect(modelSupportsVision(null)).toBe(false);
    expect(modelSupportsVision(undefined)).toBe(false);
  });
});
