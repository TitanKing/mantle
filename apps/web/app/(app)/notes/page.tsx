import { requireOwner } from '@/lib/auth';
import { listNotes } from '@/lib/notes';
import { NotesClient } from './notes-client';

export default async function NotesPage() {
  const user = await requireOwner();
  const rows = await listNotes(user.id);
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Notes</h1>
        <p className="text-sm text-muted-foreground">
          Markdown notes. Title, body, and tags are summarised + embedded
          by the extractor so the assistant can semantically find them.
        </p>
      </header>
      <NotesClient initialNotes={rows} />
    </div>
  );
}
