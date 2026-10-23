import { toDate } from "./format";
import type { Ticket, TicketEvent } from "./types";

/** Time from creation to the first public agent reply, or null if there is none. */
export function firstResponseMs(ticket: Ticket, comments: TicketEvent[]): number | null {
  const created = toDate(ticket.created_at);
  const reply = comments.find((c) => c.author?.role === "agent" && c.public !== false);
  const at = toDate(reply?.created_at);

  return created && at && at >= created ? at.getTime() - created.getTime() : null;
}

export interface StatusSpan {
  status: string;
  ms: number;
  current?: boolean;
}

/** How long the ticket spent in each status, from consecutive real transitions. */
export function timeInStatus(ticket: Ticket, history: TicketEvent[], now = Date.now()): StatusSpan[] {
  const spans: StatusSpan[] = [];
  let from = toDate(ticket.created_at);
  let status = history[0]?.from || "new";

  for (const h of history) {
    const at = toDate(h.created_at);

    if (from && at) spans.push({ status, ms: at.getTime() - from.getTime() });
    status = h.to ?? status;
    from = at;
  }

  if (from) spans.push({ status, ms: now - from.getTime(), current: true });
  return spans;
}
