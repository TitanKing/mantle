import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { AudioView } from './audio-view';

/**
 * Block audio node — an inline `<audio controls>` player. Like images and file
 * embeds it references a backing `file` node by id and points `src` at the
 * `?raw=1` serve route (range-enabled, so seeking works); pages reference the
 * file, they don't inline bytes. Serialized as `<audio>` with `data-*` attrs so
 * the read-only renderer round-trips it. Part of the shared schema.
 *
 * Audio files dropped/pasted onto the canvas route here via upload.ts; insert by
 * URL also works (markdown has no audio syntax, so this is editor-driven).
 */
export const PageAudio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute('src'),
        renderHTML: (attrs) => (attrs.src ? { src: attrs.src } : {}),
      },
      nodeId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-node-id'),
        renderHTML: (attrs) => (attrs.nodeId ? { 'data-node-id': attrs.nodeId } : {}),
      },
      filename: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-filename'),
        renderHTML: (attrs) => (attrs.filename ? { 'data-filename': attrs.filename } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'audio[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['audio', mergeAttributes(HTMLAttributes, { controls: 'controls' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioView);
  },
});
