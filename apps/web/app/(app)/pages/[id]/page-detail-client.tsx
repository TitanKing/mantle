'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { JSONContent } from '@tiptap/react';
import { Check, Loader2, Save, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TagInput } from '@/components/tag-input';
import { BackLink } from '@/components/layout/back-link';
import { SetPageTitle } from '@/components/layout/page-title';
import { PageEditor } from '@/components/page-editor/page-editor';
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
import { formatDateTime } from '@/lib/format-datetime';

type PageDetail = {
  id: string;
  title: string;
  icon: string | null;
  tags: string[];
  summary: string | null;
  visibility: 'private' | 'public';
  createdAt: string;
  updatedAt: string;
  doc: Record<string, unknown>;
};

type SaveState = 'saved' | 'saving' | 'dirty';

const AUTOSAVE_MS = 900;

export function PageDetailClient({ initial }: { initial: PageDetail }) {
  const router = useRouter();
  const toast = useToast();

  const [title, setTitle] = useState(initial.title);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const docRef = useRef<JSONContent>(initial.doc as JSONContent);

  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Snapshot of what's persisted, so we never PATCH an unchanged page.
  const lastSavedRef = useRef(
    JSON.stringify({ title: initial.title, tags: initial.tags, doc: initial.doc }),
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(async () => {
    const payload = { title: title.trim() || 'Untitled page', tags, doc: docRef.current };
    const serialized = JSON.stringify(payload);
    if (serialized === lastSavedRef.current) {
      setSaveState('saved');
      return;
    }
    setSaveState('saving');
    const res = await fetch(`/api/pages/${initial.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: serialized,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Save failed');
      setSaveState('dirty');
      return;
    }
    const { page } = (await res.json()) as { page: PageDetail };
    lastSavedRef.current = serialized;
    setUpdatedAt(page.updatedAt);
    setSaveState('saved');
  }, [title, tags, initial.id, toast]);

  // Always flush with the latest closure on unmount / navigation away.
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const scheduleSave = useCallback(() => {
    setSaveState('dirty');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persistRef.current(), AUTOSAVE_MS);
  }, []);

  // Title / tags edits schedule an autosave. (Skips the initial render via the
  // lastSavedRef equality check inside persist.)
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    scheduleSave();
  }, [title, tags, scheduleSave]);

  // Flush any pending edit when leaving the editor.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void persistRef.current();
    };
  }, []);

  const onDocChange = useCallback(
    (doc: JSONContent) => {
      docRef.current = doc;
      scheduleSave();
    },
    [scheduleSave],
  );

  const saveNow = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await persist();
  };

  const confirmDelete = async () => {
    const res = await fetch(`/api/pages/${initial.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Could not delete page');
      return;
    }
    // Avoid the unmount flush re-creating the row we just deleted.
    lastSavedRef.current = JSON.stringify({ title: title.trim(), tags, doc: docRef.current });
    toast.success('Page deleted');
    router.push('/pages');
  };

  return (
    <div className="space-y-4">
      <SetPageTitle title={title || 'Untitled page'} />
      <div className="flex items-center justify-between gap-3">
        <BackLink href="/pages">All pages</BackLink>
        <SaveIndicator state={saveState} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled page"
          className="text-lg font-semibold"
        />
      </div>

      <PageEditor content={initial.doc as JSONContent} onChange={onDocChange} />

      <div className="space-y-1.5">
        <Label htmlFor="tags">Tags</Label>
        <TagInput
          id="tags"
          value={tags}
          onChange={setTags}
          placeholder="Type and press comma or Enter…"
        />
      </div>

      {initial.summary && (
        <aside className="rounded-md border border-border bg-muted/40 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden /> Indexed summary
          </div>
          <p className="text-sm text-muted-foreground">{initial.summary}</p>
        </aside>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">
          Updated {formatDateTime(updatedAt)} · created {formatDateTime(initial.createdAt)}
        </span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete page"
          >
            <Trash2 />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={saveNow}
            disabled={saveState === 'saving'}
          >
            <Save /> {saveState === 'saving' ? 'Saving…' : 'Save'}
          </Button>
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
