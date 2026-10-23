import { time } from "./format";
import type { Person, Ticket, TicketEvent } from "./types";

// The API has no customer, requester or agent endpoints, so those directories
// are derived from what tickets and events carry.

export interface Customer {
  key: string;
  id?: string | null;
  name: string;
  tickets: Ticket[];
  requesters: Map<string, Person>;
}

export interface Requester {
  key: string;
  id?: string | null;
  name: string;
  email?: string | null;
  customers: Map<string, Person>;
  tickets: Ticket[];
  events: TicketEvent[];
}

export interface Agent {
  id: string;
  name: string;
  tickets: Ticket[];
  events: TicketEvent[];
}

export interface Directory {
  customers: Map<string, Customer>;
  requesters: Map<string, Requester>;
  agents: Map<string, Agent>;
}

export const customerKey = (c: Person | null | undefined) => c?.id || c?.name || "";
export const requesterKey = (r: Person | null | undefined) =>
  String(r?.email || r?.id || r?.name || "").toLowerCase();

export function buildDirectory(tickets: Ticket[], events: TicketEvent[]): Directory {
  const customers = new Map<string, Customer>();
  const requesters = new Map<string, Requester>();
  const agents = new Map<string, Agent>();
  const byTicket = new Map(tickets.map((t) => [t.id, t]));

  const agent = (a: Partial<Person> | null | undefined): Agent | null => {
    if (!a?.id || a.id === "system") return null;
    if (!agents.has(a.id)) agents.set(a.id, { id: a.id, name: a.name || a.id, tickets: [], events: [] });
    return agents.get(a.id)!;
  };

  for (const t of tickets) {
    const ck = customerKey(t.customer);
    const rk = requesterKey(t.requester);

    if (ck && t.customer) {
      let c = customers.get(ck);

      if (!c) {
        c = { key: ck, id: t.customer.id, name: t.customer.name || ck, tickets: [], requesters: new Map() };
        customers.set(ck, c);
      }

      c.tickets.push(t);
      if (rk && t.requester) c.requesters.set(rk, t.requester);
    }

    if (rk && t.requester) {
      let r = requesters.get(rk);

      if (!r) {
        r = {
          key: rk,
          id: t.requester.id,
          name: t.requester.name || t.requester.email || rk,
          email: t.requester.email,
          customers: new Map(),
          tickets: [],
          events: [],
        };
        requesters.set(rk, r);
      }

      r.tickets.push(t);
      if (ck && t.customer) r.customers.set(ck, t.customer);
    }

    agent(t.assignee)?.tickets.push(t);
  }

  for (const e of events) {
    const ticket = byTicket.get(e.ticket_id);

    if (e.author?.role === "agent") agent(e.author)?.events.push(e);

    // A customer-role comment on a ticket belongs to that ticket's requester.
    if (e.author?.role === "customer" && ticket) {
      requesters.get(requesterKey(ticket.requester))?.events.push(e);
    }
  }

  return { customers, requesters, agents };
}

export const customerHref = (c: Person | null | undefined) =>
  customerKey(c) ? `/customers/${encodeURIComponent(customerKey(c))}` : "";
export const requesterHref = (r: Person | null | undefined) =>
  requesterKey(r) ? `/requesters/${encodeURIComponent(requesterKey(r))}` : "";
export const agentHref = (a: Person | null | undefined) =>
  a?.id && a.id !== "system" ? `/agents/${encodeURIComponent(a.id)}` : "";

export function lastActivity(tickets: Ticket[]): string | null {
  const max = Math.max(0, ...tickets.map((t) => time(t.updated_at)));
  return max ? new Date(max).toISOString() : null;
}
