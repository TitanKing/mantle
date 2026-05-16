import { requireOwner } from '@/lib/auth';
import { listApiKeys } from '@/lib/api-keys';
import { KeysClient } from './keys-client';

export default async function KeysSettingsPage() {
  const user = await requireOwner();
  const keys = await listApiKeys(user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">API keys</h1>
        <p className="text-sm text-muted-foreground">
          Encrypted at rest with your <code>MANTLE_MASTER_KEY</code>. The plaintext leaves
          the server only twice — when you create a key, and when you rotate it. Backups
          contain the ciphertext only.
        </p>
      </header>

      <KeysClient
        initialKeys={keys.map((k) => ({
          id: k.id,
          service: k.service,
          label: k.label,
          masked: k.masked,
          lastUsed: k.lastUsed?.toISOString() ?? null,
          updatedAt: k.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
