// hi
import type { Agent } from "@/types/agents";
import { Badge, IconTile } from "@/components/ui";
import { cn } from "@/utils/cn";
import { AGENT_LOOK, STATUS_LOOK } from "./agentMeta";

/** One agent: role, live status, last action and the tools it can call. */
export function AgentCard({ agent, className, children }: { agent: Agent; className?: string; children?: React.ReactNode }) {
  const { icon: Icon, tone } = AGENT_LOOK[agent.id];
  const status = STATUS_LOOK[agent.status];
  const busy = agent.status !== "idle" && agent.status !== "paused";

  return (
    <article
      id={`agent-${agent.id}`}
      className={cn(
        "flex scroll-mt-24 flex-col rounded-lg border bg-surface p-5 shadow-sm transition-[border-color,box-shadow] duration-300",
        busy ? "border-ai/45 shadow-glow-ai" : "border-border",
        className,
      )}
    >
      <header className="flex items-start gap-3">
        <IconTile icon={<Icon />} tone={tone} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold text-fg">{agent.name}</h3>
            <Badge tone={status.tone} size="sm" dot pulse={busy}>
              {status.label}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">{agent.role}</p>
        </div>
      </header>

      <div className="mt-4 rounded-md bg-surface-sunken px-3 py-2.5">
        <p className="micro-label text-fg-subtle">Last action</p>
        <p className="mt-1 text-sm text-fg">{agent.lastAction}</p>
      </div>

      <div className="mt-4">
        <p className="micro-label text-fg-subtle">Tools it can call</p>
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${agent.name} tools`}>
          {agent.tools.map((t) => (
            <li key={t} className="rounded-sm border border-border bg-surface px-2 py-0.5 font-mono text-[13px] text-fg-muted">
              {t}
            </li>
          ))}
        </ul>
      </div>

      {children}
    </article>
  );
}
