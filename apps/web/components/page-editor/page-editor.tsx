'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react';
import { CharacterCount, TrailingNode } from '@tiptap/extensions';
import { pageExtensions } from './extensions';
import { EditorBubbleMenu } from './bubble-menu';
import { EditorDragHandle } from './drag-handle';
import { TableControls } from './table-controls';
import { SlashCommand } from './slash-command';
import { INSERT_YOUTUBE_EVENT } from './slash-menu';
import { handleDroppedFiles } from './upload';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/**
 * The "invisible" editing surface: no border, no card, no fixed toolbar — just
 * text on the page. Formatting comes from markdown shortcuts and the selection
 * bubble menu (and, next slice, the slash menu).
 *
 * `content` is the initial doc (the editor owns its state after). Callbacks are
 * kept in refs so the editor's once-bound handlers always call the latest
 * closures — otherwise a debounced autosave that re-creates them goes stale.
 */
export function PageEditor({
  content,
  onChange,
  onBlur,
  onEditorReady,
}: {
  content: JSONContent;
  onChange: (doc: JSONContent) => void;
  /** Editor lost focus — a natural "settle" signal to flush / re-index. */
  onBlur?: () => void;
  /** Hands the editor instance up once ready (e.g. so the title can move focus
   *  into the body on Enter). */
  onEditorReady?: (editor: Editor) => void;
}) {
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const onReadyRef = useRef(onEditorReady);
  // Holds the editor for the once-bound drop/paste handlers (they're defined in
  // the useEditor config, before `editor` is assigned).
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
    onReadyRef.current = onEditorReady;
  }, [onChange, onBlur, onEditorReady]);

  const editor = useEditor({
    // SlashCommand, TrailingNode, and CharacterCount are editor-only (no stored
    // schema), so the read-only PageView stays identical. TrailingNode keeps a
    // clickable empty line after a trailing block (table/embed/callout);
    // CharacterCount powers the word-count readout.
    extensions: [...pageExtensions, SlashCommand, TrailingNode, CharacterCount],
    content,
    immediatelyRender: false, // required for Next.js SSR (avoids hydration mismatch)
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none min-h-[50vh] focus:outline-none',
      },
      // Drop images/files onto the canvas → upload + insert at the drop point.
      handleDrop: (view, event) => {
        const dt = (event as DragEvent).dataTransfer;
        const files = Array.from(dt?.files ?? []);
        if (files.length === 0) return false;
        const pos = view.posAtCoords({
          left: (event as DragEvent).clientX,
          top: (event as DragEvent).clientY,
        })?.pos;
        if (!editorRef.current) return false;
        return handleDroppedFiles(editorRef.current, files, pos);
      },
      // Paste an image/file from the clipboard → upload + insert.
      handlePaste: (_view, event) => {
        const files = Array.from((event as ClipboardEvent).clipboardData?.files ?? []);
        if (files.length === 0) return false;
        if (!editorRef.current) return false;
        return handleDroppedFiles(editorRef.current, files);
      },
    },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getJSON()),
    onBlur: () => onBlurRef.current?.(),
  });

  useEffect(() => {
    editorRef.current = editor;
    if (editor) onReadyRef.current?.(editor);
  }, [editor]);

  // YouTube insert: the slash item fires a DOM event (it has no React handle);
  // we open the URL dialog and insert at the current cursor on submit.
  const [ytOpen, setYtOpen] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  useEffect(() => {
    const open = () => {
      setYtUrl('');
      setYtOpen(true);
    };
    window.addEventListener(INSERT_YOUTUBE_EVENT, open);
    return () => window.removeEventListener(INSERT_YOUTUBE_EVENT, open);
  }, []);

  const insertYoutube = () => {
    const src = ytUrl.trim();
    if (src && editorRef.current) editorRef.current.commands.setYoutubeVideo({ src });
    setYtOpen(false);
  };

  if (!editor) return null;

  return (
    <>
      <EditorBubbleMenu editor={editor} />
      <EditorDragHandle editor={editor} />
      <TableControls editor={editor} />
      <EditorContent editor={editor} />

      <Dialog open={ytOpen} onOpenChange={setYtOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Embed YouTube video</DialogTitle>
            <DialogDescription>Paste a YouTube video link.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              insertYoutube();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="yt-url">Video URL</Label>
              <Input
                id="yt-url"
                value={ytUrl}
                onChange={(e) => setYtUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                autoFocus
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={!ytUrl.trim()}>
                Embed
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
