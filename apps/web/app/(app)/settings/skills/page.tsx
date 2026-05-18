import { eq } from 'drizzle-orm';
import { db, tools } from '@mantle/db';
import { requireOwner } from '@/lib/auth';
import { listSkills } from '@/lib/skills';
import { SkillsClient } from './skills-client';

export default async function SkillsPage() {
  const user = await requireOwner();
  const [skillRows, toolRows] = await Promise.all([
    listSkills(user.id),
    db
      .select({
        slug: tools.slug,
        name: tools.name,
        description: tools.description,
        requiresConfirm: tools.requiresConfirm,
        handler: tools.handler,
      })
      .from(tools)
      .where(eq(tools.ownerId, user.id))
      .orderBy(tools.slug),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Skills</h1>
        <p className="text-sm text-muted-foreground">
          A skill is a behaviour pack: instructions + suggested toolset. Attach skills
          to agents on <a href="/settings/agents" className="underline">/settings/agents</a>.
          When attached, the skill&apos;s instructions append to the agent&apos;s system
          prompt and its tools join the agent&apos;s allowlist (always-loaded mode in v1).
        </p>
      </header>
      <SkillsClient
        initialSkills={skillRows}
        availableTools={toolRows.map((t) => ({
          slug: t.slug,
          name: t.name,
          description: t.description,
          requiresConfirm: t.requiresConfirm,
          kind: (t.handler as { kind: string }).kind,
        }))}
      />
    </div>
  );
}
