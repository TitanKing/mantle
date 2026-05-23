'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { Copy, GripVertical, Trash2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Block gutter handle — one grip that does both: drag to reorder, click for
 * actions (Duplicate / Delete on the block it's over).
 *
 * The grip is a plain element with a native onClick. We deliberately do NOT
 * wrap it in a Radix menu trigger: the trigger preventDefaults pointerdown,
 * which swallows the native dragstart (the old "grab cursor but no movement"
 * bug). A plain onClick fires only on a click (not a drag), so both coexist —
 * so the menu is a small custom popover portaled to <body> rather than the
 * shadcn DropdownMenu.
 */
export function EditorDragHandle({ editor }: { editor: Editor }) {
  const posRef = useRef<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const openMenu = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: Math.min(r.right + 6, window.innerWidth - 196),
      y: Math.min(r.top, window.innerHeight - 96),
    });
  };
  const close = () => setMenu(null);

  const remove = () => {
    const pos = posRef.current;
    close();
    if (pos == null || pos < 0) return;
    editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
  };

  const duplicate = () => {
    const pos = posRef.current;
    close();
    if (pos == null || pos < 0) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
  };

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  return (
    <>
      <DragHandle
        editor={editor}
        onNodeChange={({ node, pos }) => {
          posRef.current = node ? pos : null;
        }}
      >
        <div
          role="button"
          aria-label="Drag to move · click for actions"
          onClick={openMenu}
          className="mr-2 flex h-7 w-6 cursor-grab items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-5" aria-hidden />
        </div>
      </DragHandle>

      {menu &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={close}
              onContextMenu={(e) => {
                e.preventDefault();
                close();
              }}
            />
            <div
              role="menu"
              className="fixed z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
              style={{ left: menu.x, top: menu.y }}
            >
              <MenuItem icon={Copy} label="Duplicate" onClick={duplicate} />
              <MenuItem icon={Trash2} label="Delete" onClick={remove} destructive />
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-accent',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}
