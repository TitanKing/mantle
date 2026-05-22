import StarterKit from '@tiptap/starter-kit';
import type { Extensions } from '@tiptap/react';

/**
 * Shared editor schema for the pages surface. The live editor (`PageEditor`)
 * and the read-only renderer (`PageView`) MUST use the same extension set, or
 * a doc authored in one renders wrong in the other.
 *
 * Phase 3a is StarterKit only (paragraphs, headings, lists, quote, code,
 * marks, history). Custom nodes — callout, image/file embed, icon, mentions —
 * land in 3b/3c and get appended here.
 */
export const pageExtensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
  }),
];
