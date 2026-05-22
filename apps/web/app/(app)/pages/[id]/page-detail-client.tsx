'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Editor, JSONContent } from '@tiptap/react';
import { Check, Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TagInput } from '@/components/tag-input';
import { BackLink } from '@/components/layout/back-link';
import { SetPageTitle } from '@/components/layout/page-title';
import { PageEditor } from '@/components/page-editor/page-editor';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

type PageWidth = 'narrow' | 'wide';

type PageDetail = {
  id: string;
  title: string;
  icon: string | null;
  tags: string[];
  summary: string | null;
  visibility: 'private' | 'public';
  width: PageWidth;
  createdAt: string;
  updatedAt: string;
  doc: Record<string, unknown>;
};

type SaveState = 'saved' | 'saving' | 'dirty';

// Persistence is cheap (one UPDATE) so it runs often, for durability.
// Indexing is expensive (extractor: LLM summary + embedding + facts) so it
// runs only when editing has clearly settled. Two cadences on purpose.
const PERSIST_DEBOUNCE_MS = 1500; // quiet period before a cheap save
const PERSIST_MAX_WAIT_MS = 8000; // …but never let unsaved text get older than this
const INDEX_IDLE_MS = 12000; // stop typing this long → re-index once

export function PageDetailClient({ initial }: { initial: PageDetail }) {
  const router = useRouter();
  const toast = useToast();

  const [title, setTitle] = useState(initial.title);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [width, setWidth] = useState<PageWidth>(initial.width);
  const docRef = useRef<JSONContent>(initial.doc as JSONContent);
  const editorRef = useRef<Editor | null>(null);

  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [deleteOpen, setDeleteOpen] = useState(false);

  // `persistedRef` = what's in the DB; `indexedRef` = what the extractor last
  // saw (doc only). The initial doc arrives already indexed.
  const persistedRef = useRef(
    JSON.stringify({ title: initial.title, tags: initial.tags, doc: initial.doc }),
  );
  const indexedRef = useRef(JSON.stringify(initial.doc));
  const lastPersistAtRef = useRef(Date.now());
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletedRef = useRef(false);

  // ── Cheap save: persist the document, do NOT re-index. ──────────────
  const persist = useCallback(async () => {
    if (deletedRef.current) return;
    const payload = { title: title.trim() || 'Untitled page', tags, doc: docRef.current };
    const serialized = JSON.stringify(payload);
    if (serialized === persistedRef.current) {
      setSaveState('saved');
      return;
    }
    setSaveState('saving');
    const res = await fetch(`/api/pages/${initial.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, reindex: false }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Save failed');
      setSaveState('dirty');
      return;
    }
    persistedRef.current = serialized;
    lastPersistAtRef.current = Date.now();
    setSaveState('saved');
  }, [title, tags, initial.id, toast]);

  // ── Expensive commit: ensure persisted, then re-index once. ─────────
  const commit = useCallback(async () => {
    if (deletedRef.current) return;
    await persist();
    const docStr = JSON.stringify(docRef.current);
    if (docStr === indexedRef.current) return; // nothing new to index
    const res = await fetch(`/api/pages/${initial.id}/reindex`, { method: 'POST' });
    if (res.ok) indexedRef.current = docStr;
  }, [persist, initial.id]);

  // Timers fire stale closures otherwise — always reach the latest fns.
  const persistRef = useRef(persist);
  const commitRef = useRef(commit);
  useEffect(() => {
    persistRef.current = persist;
    commitRef.current = commit;
  }, [persist, commit]);

  const scheduleSave = useCallback(() => {
    setSaveState('dirty');
    if (persistTimer.current) clearTimeout(persistTimer.current);
    const sincePersist = Date.now() - lastPersistAtRef.current;
    const wait = sincePersist >= PERSIST_MAX_WAIT_MS ? 0 : PERSIST_DEBOUNCE_MS;
    persistTimer.current = setTimeout(() => void persistRef.current(), wait);
    if (indexTimer.current) clearTimeout(indexTimer.current);
    indexTimer.current = setTimeout(() => void commitRef.current(), INDEX_IDLE_MS);
  }, []);

  // Title / tags edits schedule a save (skips the initial render).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    scheduleSave();
  }, [title, tags, scheduleSave]);

  // Leaving the editor: flush + index whatever's pending.
  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      if (indexTimer.current) clearTimeout(indexTimer.current);
      void commitRef.current();
    };
  }, []);

  const onDocChange = useCallback(
    (doc: JSONContent) => {
      docRef.current = doc;
      scheduleSave();
    },
    [scheduleSave],
  );

  // Blur of the editor body is a natural "I paused" signal → index now.
  const onEditorBlur = useCallback(() => void commitRef.current(), []);
  const onEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
  }, []);

  // Enter in the title drops focus into the body, like Notion.
  const onTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editorRef.current?.commands.focus('start');
    }
  };

  const applyWidth = async (next: PageWidth) => {
    if (next === width) return;
    setWidth(next); // optimistic
    try {
      await fetch(`/api/pages/${initial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ width: next, reindex: false }),
      });
    } catch {
      // Width is a cosmetic preference; a failed write just reverts next load.
    }
  };

  const confirmDelete = async () => {
    deletedRef.current = true; // suppress the unmount flush
    const res = await fetch(`/api/pages/${initial.id}`, { method: 'DELETE' });
    if (!res.ok) {
      deletedRef.current = false;
      toast.error('Could not delete page');
      return;
    }
    toast.success('Page deleted');
    router.push('/pages');
  };

  return (
    <div className="flex min-h-full flex-col">
      <SetPageTitle title={title || 'Untitled page'} />

      {/* Whisper-quiet top strip — the only chrome on the canvas. */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-2 backdrop-blur">
        <BackLink href="/pages">All pages</BackLink>
        <div className="flex items-center gap-2">
          <SaveIndicator state={saveState} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Page options">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuCheckboxItem
                checked={width === 'wide'}
                onCheckedChange={(c) => void applyWidth(c ? 'wide' : 'narrow')}
              >
                Full width
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 /> Delete page
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* The canvas — width follows the per-page toggle. */}
      <div
        className={cn(
          'mx-auto w-full px-6 py-10',
          width === 'wide' ? 'max-w-none' : 'max-w-3xl',
        )}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onTitleKeyDown}
          placeholder="New page"
          aria-label="Page title"
          className="h-auto border-0 bg-transparent px-0 py-0 text-3xl font-bold shadow-none placeholder:text-muted-foreground/40 focus-visible:ring-0 md:text-3xl"
        />
        <div className="mt-3">
          <TagInput value={tags} onChange={setTags} placeholder="Add tags…" />
        </div>
        <div className="mt-6">
          <PageEditor
            content={initial.doc as JSONContent}
            onChange={onDocChange}
            onBlur={onEditorBlur}
            onEditorReady={onEditorReady}
          />
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{title || 'Untitled page'}”?</AlertDialogTitle>
            <AlertDialogDescription>This can’t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…
      </span>
    );
  }
  if (state === 'dirty') {
    return <span className="text-xs text-muted-foreground">Unsaved changes</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Check className="size-3.5" aria-hidden /> Saved
    </span>
  );
}
