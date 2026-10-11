// Shared copy of the list-level data (all tickets + all events) and the
// entities derived from it. The API has no customer, requester or agent
// endpoints, so those directories are built from what tickets and events carry.

import { listAllTickets, getEvents } from "./api.js";
import { toDate } from "./lib.js";

export const store = {
  tickets: [],
  events: [],
  ticketsState: "idle", // idle | loading | ready | error
  eventsState: "idle",
  ticketsError: "",
  eventsError: "",
  version: 0,
};

let inflight = null;
let derived = null;

const changed = () => {
  store.version += 1;
  derived = null;
  window.dispatchEvent(new CustomEvent("store-change"));
};

export function loadCore() {
  if (inflight) return inflight;
  if (!store.tickets.length) store.ticketsState = "loading";
  if (!store.events.length) store.eventsState = "loading";
  inflight = Promise.all([
    listAllTickets().then(
      (list) => {
        store.tickets = list.sort(
          (a, b) =>
            (toDate(b.updated_at) || 0) - (toDate(a.updated_at) || 0) ||
            String(b.id).localeCompare(String(a.id), undefined, { numeric: true }),
        );
        store.ticketsState = "ready";
        store.ticketsError = "";
      },
      (e) => {
        store.ticketsState = "error";
        store.ticketsError = e.message;
      },
    ),
    getEvents().then(
      (list) => {
        store.events = list;
        store.eventsState = "ready";
        store.eventsError = "";
      },
      (e) => {
        store.eventsState = "error";
        store.eventsError = e.message;
      },
    ),
  ]).finally(() => {
    inflight = null;
    changed();
  });
  return inflight;
}
export const ensureCore = () =>
  store.ticketsState === "ready" && store.eventsState === "ready" ? Promise.resolve() : loadCore();

export const ticketById = (id) => store.tickets.find((t) => t.id === id);

// ----- derived directories ----------------------------------------------------

const customerKey = (c) => c?.id || c?.name || "";
const requesterKey = (r) => String(r?.email || r?.id || r?.name || "").toLowerCase();

export function directory() {
  if (derived) return derived;
  const customers = new Map();
  const requesters = new Map();
  const agents = new Map();
  const byTicket = new Map(store.tickets.map((t) => [t.id, t]));

  const agent = (a) => {
    if (!a?.id || a.id === "system") return null;
    if (!agents.has(a.id))
      agents.set(a.id, { id: a.id, name: a.name || a.id, tickets: [], events: [] });
    return agents.get(a.id);
  };

  for (const t of store.tickets) {
    const ck = customerKey(t.customer);
    if (ck) {
      if (!customers.has(ck))
        customers.set(ck, {
          key: ck,
          id: t.customer.id,
          name: t.customer.name || ck,
          tickets: [],
          requesters: new Map(),
        });
      const c = customers.get(ck);
      c.tickets.push(t);
      const rk0 = requesterKey(t.requester);
      if (rk0) c.requesters.set(rk0, t.requester);
    }
    const rk = requesterKey(t.requester);
    if (rk) {
      if (!requesters.has(rk))
        requesters.set(rk, {
          key: rk,
          id: t.requester.id,
          name: t.requester.name || t.requester.email,
          email: t.requester.email,
          customers: new Map(),
          tickets: [],
          events: [],
        });
      const r = requesters.get(rk);
      r.tickets.push(t);
      if (ck) r.customers.set(ck, t.customer);
    }
    agent(t.assignee)?.tickets.push(t);
  }

  for (const e of store.events) {
    const ticket = byTicket.get(e.ticket_id);
    if (e.author?.role === "agent") agent(e.author)?.events.push(e);
    // A customer-role comment on a ticket belongs to that ticket's requester.
    if (e.author?.role === "customer" && ticket) {
      requesters.get(requesterKey(ticket.requester))?.events.push(e);
    }
  }

  derived = { customers, requesters, agents };
  return derived;
}

export const customerHref = (c) => (customerKey(c) ? `/customers/${encodeURIComponent(customerKey(c))}` : "");
export const requesterHref = (r) => (requesterKey(r) ? `/requesters/${encodeURIComponent(requesterKey(r))}` : "");
export const agentHref = (a) => (a?.id && a.id !== "system" ? `/agents/${encodeURIComponent(a.id)}` : "");
export { customerKey, requesterKey };

// ----- ticket statistics --------------------------------------------------------

export function lastActivity(tickets) {
  let max = 0;
  for (const t of tickets) max = Math.max(max, toDate(t.updated_at)?.getTime() || 0);
  return max ? new Date(max).toISOString() : null;
}
