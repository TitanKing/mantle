'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
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
import { denyAllMarketing } from './actions';

/**
 * Conditional bulk-deny affordance for the pending tab. Renders only when
 * the server-side count of marketing-dominant pending senders (honouring
 * the active search) is ≥ 1 — the presence of the button is itself the
 * hint that there's bulk work to do, with the count baked into the label.
 *
 * Behind an AlertDialog because this is destructive in the soft sense:
 * once denied, senders stop appearing in `pending` and the user has to
 * actively reset them. The action receives the current search via the
 * form so the deny scopes to *what the operator is currently seeing*.
 */
export function DenyMarketingButton({ count, search }: { count: number; search: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (count <= 0) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Deny {count} marketing {count === 1 ? 'sender' : 'senders'}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deny {count} marketing {count === 1 ? 'sender' : 'senders'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This moves every pending sender currently classified as
              marketing
              {search ? <> (matching “{search}”)</> : null} into the Denied
              tab. You can reset any of them individually later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const fd = new FormData();
                  if (search) fd.set('q', search);
                  await denyAllMarketing(fd);
                  setOpen(false);
                })
              }
            >
              {pending ? 'Denying…' : 'Deny all'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
