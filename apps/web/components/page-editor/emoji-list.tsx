'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';

/** A subset of `@tiptap/extension-emoji`'s EmojiItem — the fields the picker
 *  needs. `emoji` is the native glyph; `name` is the stored shortcode. */
export type EmojiPickItem = {
  name: string;
  emoji?: string;
  shortcodes: string[];
};

export type EmojiListHandle = { onKeyDown: (p: { event: KeyboardEvent }) => boolean };

export type EmojiListProps = {
  items: EmojiPickItem[];
  command: (item: EmojiPickItem) => void;
};

const COLS = 8;

/** The `:` emoji picker — a glyph grid with arrow-key navigation, mirroring the
 *  mention popup's keyboard contract (the suggestion plugin forwards keys here). */
export const EmojiList = forwardRef<EmojiListHandle, EmojiListProps>(function EmojiList(
  { items, command },
  ref,
) {
  const [selected, setSelected] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelected(0), [items]);

  useLayoutEffect(() => {
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = (i: number) => {
    const item = items[i];
    if (item) command(item);
  };

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        const len = items.length;
        if (len === 0) return false;
        if (event.key === 'ArrowRight') {
          setSelected((s) => (s + 1) % len);
          return true;
        }
        if (event.key === 'ArrowLeft') {
          setSelected((s) => (s - 1 + len) % len);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelected((s) => Math.min(s + COLS, len - 1));
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelected((s) => Math.max(s - COLS, 0));
          return true;
        }
        if (event.key === 'Enter') {
          choose(selected);
          return true;
        }
        return false;
      },
    }),
    [items, selected],
  );

  if (items.length === 0) {
    return (
      <div className="w-64 rounded-xl border border-border bg-popover p-3 text-sm text-muted-foreground shadow-lg">
        No matching emoji
      </div>
    );
  }

  const active = items[selected];

  return (
    <div className="w-64 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
      <div
        ref={containerRef}
        className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto scrollbar-thin"
      >
        {items.map((item, i) => (
          <button
            key={item.name}
            type="button"
            data-index={i}
            title={`:${item.name}:`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => choose(i)}
            className={cn(
              'flex aspect-square items-center justify-center rounded-md text-xl leading-none transition-colors',
              i === selected ? 'bg-accent' : 'hover:bg-accent/50',
            )}
          >
            {item.emoji ?? `:${item.name}:`}
          </button>
        ))}
      </div>
      {active && (
        <div className="truncate px-1.5 pt-1.5 text-xs text-muted-foreground">:{active.name}:</div>
      )}
    </div>
  );
});
