import { Emoji, gitHubEmojis, type EmojiItem } from '@tiptap/extension-emoji';
import { ReactRenderer } from '@tiptap/react';
import {
  EmojiList,
  type EmojiListHandle,
  type EmojiListProps,
  type EmojiPickItem,
} from './emoji-list';

/**
 * `:` emoji picker. Renders emojis as inline nodes storing only a shortcode
 * `name` (e.g. `tada`); the glyph is resolved at render time from `gitHubEmojis`
 * (in-app by the extension, on the public page by render-page-doc). The
 * shortcode lands in `doc_text` via docToText's label fallback, so the brain can
 * search "tada"/"party" without a glyph→text map in @mantle/content.
 *
 * We replace the extension's default `suggestion` wholesale (configure does a
 * shallow merge), so this object also carries `char` + `command`.
 */

/** Only emojis with a native glyph (skip image-only custom entries). */
const PICKABLE: EmojiPickItem[] = gitHubEmojis
  .filter((e) => !!e.emoji)
  .map((e) => ({ name: e.name, emoji: e.emoji, shortcodes: e.shortcodes }));

function filterEmojis(query: string): EmojiPickItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return PICKABLE.slice(0, 40);
  return PICKABLE.filter(
    (e) => e.name.includes(q) || e.shortcodes.some((s) => s.includes(q)),
  ).slice(0, 40);
}

export const PageEmoji = Emoji.configure({
  emojis: gitHubEmojis,
  enableEmoticons: true,
  suggestion: {
    char: ':',

    items: ({ query }): EmojiPickItem[] => filterEmojis(query),

    command: ({ editor, range, props }) => {
      const item = props as unknown as EmojiItem;
      const after = editor.view.state.selection.$to.nodeAfter;
      if (after?.text?.startsWith(' ')) range.to += 1;
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'emoji', attrs: { name: item.name } },
          { type: 'text', text: ' ' },
        ])
        .run();
    },

    render: () => {
      let component: ReactRenderer<EmojiListHandle, EmojiListProps> | null = null;
      let popup: HTMLDivElement | null = null;

      const reposition = (rectFn?: (() => DOMRect | null) | null) => {
        if (!popup || !rectFn) return;
        const rect = rectFn();
        if (!rect) return;
        const margin = 6;
        const height = popup.offsetHeight;
        const flipUp =
          rect.bottom + margin + height > window.innerHeight && rect.top - margin - height > 0;
        popup.style.left = `${Math.round(rect.left)}px`;
        popup.style.top = `${Math.round(flipUp ? rect.top - margin - height : rect.bottom + margin)}px`;
      };

      const close = () => {
        popup?.remove();
        popup = null;
        component?.destroy();
        component = null;
      };

      return {
        onStart: (props) => {
          component = new ReactRenderer(EmojiList, { props, editor: props.editor });
          popup = document.createElement('div');
          popup.style.position = 'fixed';
          popup.style.zIndex = '50';
          popup.appendChild(component.element);
          document.body.appendChild(popup);
          reposition(props.clientRect);
          requestAnimationFrame(() => reposition(props.clientRect));
        },
        onUpdate: (props) => {
          component?.updateProps(props);
          reposition(props.clientRect);
        },
        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            close();
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => close(),
      };
    },
  },
});
