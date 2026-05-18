import { requireOwner } from '@/lib/auth';
import { listSecretTags, listSecrets } from '@/lib/secrets';
import { SecretsClient } from './secrets-client';

export default async function SecretsPage() {
  const user = await requireOwner();
  const [rows, tags] = await Promise.all([
    listSecrets(user.id),
    listSecretTags(user.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Secrets</h1>
        <p className="text-sm text-muted-foreground">
          Encrypted passwords, tokens, server credentials, and free-form
          notes. The <strong>title</strong>, <strong>description</strong>,
          and <strong>tags</strong> stay searchable so the assistant can
          help you find &ldquo;the Linode root password&rdquo; without
          ever decrypting the value. Notes and fields are sealed with
          AES-256-GCM and only revealed on click.
        </p>
      </header>
      <SecretsClient initialSecrets={rows} availableTags={tags} />
    </div>
  );
}
