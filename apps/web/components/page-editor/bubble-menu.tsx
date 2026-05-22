'use client';

import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

function ToolButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn('size-8', active && 'bg-accent text-accent-foreground')}
    >
      <Icon />
    </Button>
  );
}

/**
 * Selection bubble menu — the chromeless replacement for a fixed toolbar.
 * It floats above selected text so formatting controls appear only when you
 * reach for them, then vanish. Active states track the selection reactively.
 */
export function EditorBubbleMenu({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      code: editor.isActive('codeBlock'),
      h1: editor.isActive('heading', { level: 1 }),
      h2: editor.isActive('heading', { level: 2 }),
      bullet: editor.isActive('bulletList'),
      ordered: editor.isActive('orderedList'),
      quote: editor.isActive('blockquote'),
    }),
  });

  return (
    <BubbleMenu
      editor={editor}
      className="flex items-center gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <ToolButton
        label="Bold"
        icon={Bold}
        active={s.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolButton
        label="Italic"
        icon={Italic}
        active={s.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolButton
        label="Strikethrough"
        icon={Strikethrough}
        active={s.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolButton
        label="Inline code block"
        icon={Code2}
        active={s.code}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />

      <Separator orientation="vertical" className="mx-1 h-6" />

      <ToolButton
        label="Heading 1"
        icon={Heading1}
        active={s.h1}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToolButton
        label="Heading 2"
        icon={Heading2}
        active={s.h2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolButton
        label="Bullet list"
        icon={List}
        active={s.bullet}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolButton
        label="Numbered list"
        icon={ListOrdered}
        active={s.ordered}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolButton
        label="Quote"
        icon={Quote}
        active={s.quote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
    </BubbleMenu>
  );
}
