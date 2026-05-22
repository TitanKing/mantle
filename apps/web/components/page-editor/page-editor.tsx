'use client';

import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import { cn } from '@/lib/utils';
import { pageExtensions } from './extensions';
import { EditorToolbar } from './toolbar';

/**
 * The live, editable TipTap surface for a page. `content` is the initial
 * ProseMirror doc (the editor owns its state thereafter); `onChange` fires on
 * every edit with the current JSON. We keep `onChange` in a ref so the
 * editor's `onUpdate` closure always calls the latest handler — otherwise a
 * debounced autosave that re-creates its callback would go stale.
 */
export function PageEditor({
  content,
  onChange,
  className,
}: {
  content: JSONContent;
  onChange: (doc: JSONContent) => void;
  className?: string;
}) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: pageExtensions,
    content,
    immediatelyRender: false, // required for Next.js SSR (avoids hydration mismatch)
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none min-h-[60vh] px-4 py-3 focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getJSON()),
  });

  if (!editor) return null;

  return (
    <div className={cn('rounded-md border border-border bg-card', className)}>
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
