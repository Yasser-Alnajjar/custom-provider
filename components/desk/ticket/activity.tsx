"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { timeInStatus } from "@/lib/ticket-metrics";
import type { Ticket, TicketEvent } from "@/lib/types";
import { RoleBadge, StatusBadge } from "../badges";
import { EventItem, Transition } from "../event-item";
import { Empty, Panel, Segmented } from "../panel";
import { Time } from "../time";

type Tab = "all" | "status_changed" | "comment" | "history";

export function Activity({
  ticket,
  events,
  history,
  errors,
  onRetry,
}: {
  ticket: Ticket;
  events: TicketEvent[] | null;
  history: TicketEvent[] | null;
  errors: { events?: string; history?: string };
  onRetry: () => void;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const count = (type: string) => events?.filter((e) => e.type === type).length ?? 0;

  const failed = (key: "events" | "history") => (
    <Empty className="text-bad">
      Could not load {key}: {errors[key]}<br />
      <Button variant="link" size="sm" onClick={onRetry}>Try again</Button>
    </Empty>
  );

  let body: React.ReactNode;

  if (tab === "history") {
    if (!history) body = failed("history");
    else if (!history.length) body = <Empty>No status changes recorded.</Empty>;
    else {
      const spans = timeInStatus(ticket, history);

      body = (
        <>
          <div className="flex flex-wrap items-center gap-1 px-[18px] pb-3">
            {spans.map((sp, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="px-[3px] text-[#5c6c85]">→</span>}
                <span className="flex flex-col items-start gap-0.5">
                  <StatusBadge status={sp.status} />
                  <small className="text-nano text-[#6e7e96]">{sp.current ? "now · " : ""}{formatDuration(sp.ms)}</small>
                </span>
              </span>
            ))}
          </div>
          <div className="px-[18px] pb-3">
            {[...history].reverse().map((h) => (
              <div key={h.id} className="flex gap-3 py-2.5">
                <div className="grid size-6 shrink-0 place-items-center rounded-full bg-[#162338] text-micro text-[#8fa3c4]">↻</div>
                <div>
                  <div className="text-small"><b>Status changed</b> · <Transition from={h.from} to={h.to} /></div>
                  <div className="mt-0.5 text-micro text-[#78869d]">{h.author?.name || "System"} <RoleBadge role={h.author?.role} /> · <Time value={h.created_at} /></div>
                </div>
              </div>
            ))}
          </div>
        </>
      );
    }
  } else if (!events) {
    body = failed("events");
  } else {
    const list = events.filter((e) => tab === "all" || e.type === tab).reverse();

    body = list.length ? (
      <div className="px-[18px] pb-3">{list.map((e) => <EventItem key={e.id} event={e} showTicket={false} />)}</div>
    ) : (
      <Empty>No activity of this type.</Empty>
    );
  }

  return (
    <Panel
      title="Activity & history"
      action={
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { key: "all", label: "All activity", count: events?.length ?? 0 },
            { key: "status_changed", label: "Status changes", count: count("status_changed") },
            { key: "comment", label: "Comments", count: count("comment") },
            { key: "history", label: "Status history", count: history?.length ?? 0 },
          ]}
        />
      }
    >
      {body}
    </Panel>
  );
}
