import { requireOwner } from '@/lib/auth';
import { ChangePasswordForm } from './change-password-form';

export default async function SecuritySettingsPage() {
  const user = await requireOwner();

  return (
    <div className="mx-auto max-w-md space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Security</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Change password
        </h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
