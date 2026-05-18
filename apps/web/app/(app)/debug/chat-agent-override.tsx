'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type AgentOption = {
  id: string;
  name: string;
  role: string;
  model: string;
  enabled: boolean;
};

export function ChatAgentOverride({
  chatId,
  current,
  agents,
}: {
  chatId: string;
  current: string | null;
  agents: AgentOption[];
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(current ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  // Responders + assistants are the natural override candidates; custom
  // agents are allowed too in case the user has pinned a one-off persona.
  const candidates = agents.filter(
    (a) => a.role === 'responder' || a.role === 'assistant' || a.role === 'custom',
  );

  const onChange = async (next: string) => {
    const prev = value;
    setValue(next);
    setError(undefined);
    const res = await fetch(`/api/telegram/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ responderAgentId: next || null }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? 'Save failed.');
      setValue(prev);
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div className="flex flex-col gap-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs"
        title="Pin a specific responder agent to this chat. Default = global priority."
      >
        <option value="">— default —</option>
        {candidates.map((a) => (
          <option key={a.id} value={a.id} disabled={!a.enabled}>
            {a.name}
            {!a.enabled ? ' (disabled)' : ''}
          </option>
        ))}
      </select>
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </div>
  );
}
