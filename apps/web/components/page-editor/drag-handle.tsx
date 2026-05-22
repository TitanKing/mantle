'use client';

import { useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { Copy, GripVertical, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Notion-style block handle: it floats in the left gutter of the hovered
 * block. Drag it to reorder; click it for block actions. The handle self-
 * registers its ProseMirror plugin via the React component, so no extension
 * wiring is needed in the editor's extension list.
 */
export function EditorDragHandle({ editor }: { editor: Editor }) {
  // The block under the handle, tracked imperatively so the menu actions can
  // target it without re-rendering on every hover.
  const posRef = useRef<number | null>(null);

  const remove = () => {
    const pos = posRef.current;
    if (pos == null || pos < 0) return;
    editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
  };

  const duplicate = () => {
    const pos = posRef.current;
    if (pos == null || pos < 0) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
  };

  return (
    <DragHandle
      editor={editor}
      onNodeChange={({ node, pos }) => {
        posRef.current = node ? pos : null;
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Drag to move · click for actions"
            className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-40">
          <DropdownMenuItem onSelect={duplicate}>
            <Copy /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={remove}
          >
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </DragHandle>
  );
}
