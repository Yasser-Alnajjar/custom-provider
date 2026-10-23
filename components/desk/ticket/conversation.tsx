"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { TicketEvent } from "@/lib/types";
import { Avatar, RoleBadge } from "../badges";
import { Empty, Notice, Panel, Segmented } from "../panel";
import { Time } from "../time";
import { cn } from "@/lib/utils";

type Filter = "all" | "public" | "internal";

function Comment({ c }: { c: TicketEvent }) {
  const internal = c.public === false;

  return (
    <article id={c.id} className={cn("flex gap-3 px-[18px] py-3", internal && "bg-[#1f1a0f] border-l-2 border-[#6a5427]")}>
      <Avatar name={c.author?.name || "System"} large />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-small">
          <b>{c.author?.name || "Unknown"}</b> <RoleBadge role={c.author?.role} />
          {internal ? (
            <span className="rounded bg-[#352c1d] px-1.5 py-0.5 text-nano text-warn" title="Only visible to agents">🔒︎ Internal note</span>
          ) : (
            <span className="rounded bg-[#162338] px-1.5 py-0.5 text-nano text-[#8fa3c4]" title="Visible to the requester">Public</span>
          )}
          <span className="text-micro text-[#78869d]"><Time value={c.created_at} /></span>
        </div>
        <div className="mt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-[#cbd5e4]">{c.body}</div>
      </div>
    </article>
  );
}

export function Conversation({ comments, error, onRetry }: { comments: TicketEvent[] | null; error?: string; onRetry: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");

  if (error && !comments) {
    return (
      <Panel title="Conversation">
        <Empty className="text-bad">
          Could not load comments: {error}<br />
          <Button variant="link" size="sm" onClick={onRetry}>Try again</Button>
        </Empty>
      </Panel>
    );
  }

  const all = comments ?? [];
  const internal = all.filter((c) => c.public === false);
  const shown = filter === "internal" ? internal : filter === "public" ? all.filter((c) => c.public !== false) : all;

  return (
    <Panel
      title="Conversation"
      action={
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { key: "all", label: "All", count: all.length },
            { key: "public", label: "Public replies", count: all.length - internal.length },
            { key: "internal", label: "Internal notes", count: internal.length },
          ]}
        />
      }
    >
      {error && <Notice>Showing earlier data — refresh failed: {error}</Notice>}
      {shown.length ? (
        <div className="divide-y divide-line-row">{shown.map((c) => <Comment key={c.id} c={c} />)}</div>
      ) : (
        <Empty>
          {all.length ? `No ${filter === "internal" ? "internal notes" : "public comments"} on this ticket.` : "No comments yet. Add the first reply below."}
        </Empty>
      )}
    </Panel>
  );
}
