/**
 * Skill-composition helpers usable from any process (the agent runner,
 * the Next request handler, future cron workers). Pure logic — no DB
 * imports beyond what's already wired into the runtime. The CRUD lib
 * stays in apps/web for now.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db, skills, type Skill } from '@mantle/db';

export type SkillForRuntime = {
  id: string;
  slug: string;
  name: string;
  instructions: string;
  toolSlugs: string[];
};

function toRuntime(s: Skill): SkillForRuntime {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    instructions: s.instructions,
    toolSlugs: s.toolSlugs ?? [],
  };
}

/** Resolve a batch of skill slugs to enabled rows for an owner. */
export async function resolveAgentSkills(
  ownerId: string,
  slugs: string[],
): Promise<SkillForRuntime[]> {
  if (slugs.length === 0) return [];
  const rows = await db
    .select()
    .from(skills)
    .where(
      and(
        eq(skills.ownerId, ownerId),
        eq(skills.enabled, true),
        inArray(skills.slug, slugs),
      ),
    );
  return rows.map(toRuntime);
}

/**
 * Append every skill's instructions to a base system prompt as
 * `## Skill: <name>` blocks. Keeps each skill's voice fenced so the
 * model can tell which guidance belongs to which skill.
 */
export function composeSystemPromptWithSkills(
  basePrompt: string,
  skillsList: SkillForRuntime[],
): string {
  if (skillsList.length === 0) return basePrompt;
  const blocks = skillsList
    .filter((s) => s.instructions.trim().length > 0)
    .map((s) => `## Skill: ${s.name}\n\n${s.instructions.trim()}`)
    .join('\n\n');
  if (!blocks) return basePrompt;
  return `${basePrompt.trim()}\n\n${blocks}`;
}

/** Union of an agent's own toolSlugs and every attached skill's toolSlugs. */
export function effectiveToolSlugs(
  agentToolSlugs: string[],
  skillsList: SkillForRuntime[],
): string[] {
  const set = new Set<string>(agentToolSlugs);
  for (const s of skillsList) for (const slug of s.toolSlugs) set.add(slug);
  return Array.from(set);
}
