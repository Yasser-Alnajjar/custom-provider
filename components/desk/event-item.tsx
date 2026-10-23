import Link from "next/link";
import { humanize } from "@/lib/format";
import { href } from "@/lib/format";
import type { Ticket, TicketEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RoleBadge, StatusBadge } from "./badges";
import { Time } from "./time";

export function eventLabel(e: TicketEvent): string {
  if (e.type === "created") return "Ticket created";
  if (e.type === "status_changed") return "Status changed";
  if (e.type === "comment") return e.public === false ? "Internal note" : "Public comment";
  return humanize(e.type) || "Update";
}

function eventIcon(e: TicketEvent): string {
  if (e.type === "created") return "＋";
  if (e.type === "status_changed") return "↻";
  return e.public === false ? "🔒︎" : "☰";
}

export function Transition({ from, to }: { from?: string; to?: string }) {
  return (
    <>
      <StatusBadge status={from} /> <span className="px-[3px] text-[#5c6c85]">→</span> <StatusBadge status={to} />
    </>
  );
}

/** One activity entry. Comments get a visibility badge, status changes show the transition. */
export function EventItem({
  event: e,
  ticket,
  showTicket = true,
}: {
  event: TicketEvent;
  ticket?: Ticket;
  showTicket?: boolean;
}) {
  const internal = e.type === "comment" && e.public === false;

  return (
    <div className={cn("flex gap-3 py-2.5", internal && "rounded-lg bg-[#1f1a0f]/60")}>
      <div className="grid size-6 shrink-0 place-items-center rounded-full bg-[#162338] text-micro text-[#8fa3c4]">{eventIcon(e)}</div>
      <div className="min-w-0">
        <div className="text-small">
          <b>{eventLabel(e)}</b>
          {showTicket && (
            <>
              {" · "}
              <Link href={href("tickets", e.ticket_id)} className="link">
                {e.ticket_id}
              </Link>
              {ticket?.title && ` · ${ticket.title}`}
            </>
          )}
        </div>
        <div className="mt-0.5 text-micro text-[#78869d]">
          {e.author?.name || "System"} <RoleBadge role={e.author?.role} /> · <Time value={e.created_at} />
        </div>
        {e.type === "status_changed" ? (
          <div className="mt-1.5 text-small">
            <Transition from={e.from} to={e.to} />
          </div>
        ) : (
          e.body &&
          e.type !== "created" && <div className="mt-1.5 text-small whitespace-pre-wrap text-[#b9c5d8]">{e.body}</div>
        )}
      </div>
    </div>
  );
}
