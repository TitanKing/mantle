import { requireOwner } from '@/lib/auth';
import { listAssistantAgents, recentAssistantMessages, resolveAssistantAgent } from '@/lib/assistant';
import { AssistantClient } from './assistant-client';
import { AgentSelect } from './agent-select';

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const user = await requireOwner();
  const params = await searchParams;
  const [agentList, agent] = await Promise.all([
    listAssistantAgents(user.id),
    resolveAssistantAgent(user.id, params.agent),
  ]);

  // Per-agent thread: legacy (pre-agentId) rows fold into the default
  // assistant/responder; a custom agent (e.g. coder) gets a clean thread.
  const includeLegacy = agent ? agent.role === 'assistant' || agent.role === 'responder' : true;
  const messages = agent
    ? await recentAssistantMessages(user.id, 200, { agentId: agent.id, includeLegacy })
    : [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-3">
        <div>
          <h1 className="font-logo text-3xl font-normal leading-none lowercase text-foreground">
            Assistant
          </h1>
          <p className="text-xs text-muted-foreground">
            {agent ? (
              <>
                Talking to <code className="font-mono">{agent.slug}</code> ·{' '}
                <code className="font-mono">{agent.model}</code> — each agent keeps its own thread.
              </>
            ) : (
              <span className="text-destructive">
                No enabled agent. Configure one at{' '}
                <a href="/settings/agents" className="underline">
                  /settings/agents
                </a>
                .
              </span>
            )}
          </p>
        </div>
        {agentList.length > 0 && <AgentSelect agents={agentList} selected={agent?.slug ?? ''} />}
      </header>

      <AssistantClient initialMessages={messages} agentReady={!!agent} agentSlug={agent?.slug} />
    </div>
  );
}
