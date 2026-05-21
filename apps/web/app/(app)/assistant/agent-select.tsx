'use client';

import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AssistantAgentOption } from '@/lib/assistant';

/** Agent picker for /assistant. Switching navigates to ?agent=<slug>, so the
 *  server re-renders that agent's own thread (per-agent history). */
export function AgentSelect({
  agents,
  selected,
}: {
  agents: AssistantAgentOption[];
  selected: string;
}) {
  const router = useRouter();
  return (
    <Select
      value={selected}
      onValueChange={(slug) => router.push(`/assistant?agent=${encodeURIComponent(slug)}`)}
    >
      <SelectTrigger className="w-60" aria-label="Choose agent">
        <SelectValue placeholder="Select agent" />
      </SelectTrigger>
      <SelectContent>
        {agents.map((a) => (
          <SelectItem key={a.slug} value={a.slug}>
            <span className="font-medium">{a.name}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {a.role} · {a.model.split('/').pop()}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
