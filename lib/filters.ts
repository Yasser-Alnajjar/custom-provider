import { customerKey } from "./directory";
import { compare, displayName, time } from "./format";
import { STATUSES, type Ticket, type TicketEvent } from "./types";

export interface TicketFilters {
  q: string;
  status: string;
  priority: string;
  assignee: string;
  customer: string;
  channel: string;
  tag: string;
}

export function filterTickets(tickets: Ticket[], f: TicketFilters): Ticket[] {
  const q = f.q.toLowerCase().trim();

  return tickets.filter(
    (t) =>
      (!f.status || f.status.split(",").includes(t.status)) &&
      (!f.priority || t.priority === f.priority) &&
      (!f.channel || t.channel === f.channel) &&
      (!f.tag || (t.tags || []).includes(f.tag)) &&
      (!f.customer || customerKey(t.customer) === f.customer) &&
      (!f.assignee || (f.assignee === "none" ? !t.assignee : t.assignee?.id === f.assignee)) &&
      (!q ||
        [
          t.id,
          t.title,
          t.description,
          t.requester?.name,
          t.requester?.email,
          t.customer?.name,
          t.assignee?.name,
          t.channel,
          ...(t.tags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
}

const PRIORITY_RANK: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export const TICKET_SORTERS: Record<string, (t: Ticket) => string | number | undefined> = {
  id: (t) => t.id,
  title: (t) => t.title?.toLowerCase(),
  requester: (t) => displayName(t.requester).toLowerCase(),
  customer: (t) => t.customer?.name?.toLowerCase(),
  status: (t) => (STATUSES as readonly string[]).indexOf(t.status),
  priority: (t) => PRIORITY_RANK[t.priority] ?? -1,
  created_at: (t) => time(t.created_at) || undefined,
  updated_at: (t) => time(t.updated_at),
};

export function sortTickets(tickets: Ticket[], sort: string): Ticket[] {
  const [field, dir] = sort.split(":");
  const key = TICKET_SORTERS[field];

  return [...tickets].sort(
    (a, b) => compare(key(a), key(b)) * (dir === "desc" ? -1 : 1) || compare(a.id, b.id),
  );
}

export interface EventFilters {
  q: string;
  type: string;
  visibility: string;
  role: string;
}

export function filterEvents(
  events: TicketEvent[],
  f: EventFilters,
  ticketTitle: (id: string) => string | undefined,
): TicketEvent[] {
  const q = f.q.toLowerCase().trim();

  return events.filter(
    (e) =>
      (!f.type || e.type === f.type) &&
      (!f.role || e.author?.role === f.role) &&
      (!f.visibility || (f.visibility === "internal" ? e.public === false : e.public !== false)) &&
      (!q ||
        [e.ticket_id, e.body, e.author?.name, ticketTitle(e.ticket_id)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
}
