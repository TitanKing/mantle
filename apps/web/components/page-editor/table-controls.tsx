'use client';

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Combine,
  PanelTop,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CELL_BG_TOKENS, cellBgColor } from './table-cell-bg';

/**
 * Table affordances, shown only while the cursor is inside a table:
 *  - a "+" on the right edge (add column) and bottom edge (add row), and
 *  - a gear at the top-left that opens the full operations menu: insert/delete
 *    rows + columns, toggle the header row, merge/split cells, per-cell colour
 *    (theme tokens only), and delete table.
 *
 * Positioned from the live table's bounding rect (recomputed on selection
 * change + scroll/resize) rather than via a NodeView, so it stays decoupled from
 * prosemirror-tables' own DOM/resize handling. Quick-add buttons use
 * onMouseDown+preventDefault to keep the cell selection; menu actions run
 * `editor.chain().focus()…`, which restores focus to the stored selection.
 */
export function TableControls({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      inTable: editor.isActive('table'),
      from: editor.state.selection.from,
    }),
  });
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!state.inTable) {
      setRect(null);
      return;
    }
    const compute = () => {
      try {
        const dom = editor.view.domAtPos(editor.state.selection.from)?.node;
        const el = (dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null)) ?? null;
        const table = el?.closest('table');
        setRect(table ? table.getBoundingClientRect() : null);
      } catch {
        setRect(null);
      }
    };
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [state.inTable, state.from, editor]);

  if (!rect) return null;

  const btn =
    'fixed z-30 flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground';

  const run = (fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) =>
    fn(editor.chain().focus()).run();

  const setCellColor = (token: string | null) => {
    editor.chain().focus().setCellAttribute('backgroundColor', token).run();
    setMenuOpen(false);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Add column"
        className={btn}
        style={{ left: rect.right + 4, top: rect.top + rect.height / 2 - 14 }}
        onMouseDown={(e) => {
          e.preventDefault();
          run((c) => c.addColumnAfter());
        }}
      >
        <Plus className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Add row"
        className={btn}
        style={{ left: rect.left + rect.width / 2 - 14, top: rect.bottom + 4 }}
        onMouseDown={(e) => {
          e.preventDefault();
          run((c) => c.addRowAfter());
        }}
      >
        <Plus className="size-4" aria-hidden />
      </button>

      <div className="fixed z-30" style={{ left: rect.left - 32, top: rect.top - 2 }}>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Table options" className={btn}>
              <Settings2 className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-52">
            <DropdownMenuItem onSelect={() => run((c) => c.addRowBefore())}>
              <ArrowUpToLine /> Insert row above
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((c) => c.addRowAfter())}>
              <ArrowDownToLine /> Insert row below
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((c) => c.deleteRow())}>
              <Trash2 /> Delete row
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => run((c) => c.addColumnBefore())}>
              <ArrowLeftToLine /> Insert column left
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((c) => c.addColumnAfter())}>
              <ArrowRightToLine /> Insert column right
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((c) => c.deleteColumn())}>
              <Trash2 /> Delete column
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => run((c) => c.toggleHeaderRow())}>
              <PanelTop /> Toggle header row
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((c) => c.mergeOrSplit())}>
              <Combine /> Merge / split cells
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Cell colour</DropdownMenuLabel>
            <div className="flex items-center gap-1 px-2 pb-1.5 pt-0.5">
              <button
                type="button"
                aria-label="No fill"
                title="No fill"
                onClick={() => setCellColor(null)}
                className="flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground"
              >
                <span className="block h-px w-3 rotate-45 bg-current" />
              </button>
              {CELL_BG_TOKENS.map((token) => (
                <button
                  key={token}
                  type="button"
                  aria-label={`Fill ${token}`}
                  title={token}
                  onClick={() => setCellColor(token)}
                  className="size-5 rounded-full border border-border"
                  style={{ backgroundColor: cellBgColor(token) ?? undefined }}
                />
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => run((c) => c.deleteTable())}
            >
              <Trash2 /> Delete table
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
