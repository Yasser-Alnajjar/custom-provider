import { notFound, validationError } from "./errors";
import {
  PRIORITIES,
  RESOLVED_STATUSES,
  ROLES,
  STATUSES,
  type Author,
  type DbState,
  type EventType,
  type Pagination,
  type Person,
  type Ticket,
  type TicketEvent,
} from "@/lib/types";

const SYSTEM: Author = { id: "system", name: "System", role: "system" };

type Body = Record<string, unknown>;

const asAgent = (a: Person | null): Author =>
  a ? { id: a.id ?? null, name: a.name ?? null, role: "agent" } : SYSTEM;

export function addEvent(
  state: DbState,
  ticketId: string,
  type: EventType,
  at: number,
  fields: Pick<TicketEvent, "author" | "public" | "body"> & Partial<TicketEvent>,
): TicketEvent {
  const event: TicketEvent = {
    id: `evt-${++state.evtSeq}`,
    ticket_id: ticketId,
    type,
    created_at: new Date(at).toISOString(),
    ...fields,
  };

  state.events.push(event);
  return event;
}

export const findTicket = (state: DbState, id: string) => state.tickets.find((t) => t.id === id);

function requireTicket(state: DbState, id: string): Ticket {
  const ticket = findTicket(state, id);

  if (!ticket) throw notFound();
  return ticket;
}

function setStatus(state: DbState, ticket: Ticket, next: string, author?: Author) {
  if (next === ticket.status) return;

  const now = Date.now();

  addEvent(state, ticket.id, "status_changed", now, {
    author: author || asAgent(ticket.assignee),
    public: false,
    from: ticket.status,
    to: next,
    body: `Status changed from ${ticket.status} to ${next}`,
  });

  if (RESOLVED_STATUSES.includes(next)) {
    ticket.resolved_at ||= new Date(now).toISOString();
  } else {
    ticket.resolved_at = null;
  }

  ticket.status = next;
  ticket.updated_at = new Date(now).toISOString();
}

const oneOf = (list: readonly string[]) => `must be one of ${list.join(", ")}`;

export interface ListParams {
  updatedSince: string | null;
  status: string | null;
  q: string;
  page: number;
  limit: number;
}

export function parseListParams(params: URLSearchParams): ListParams {
  return {
    updatedSince: params.get("updated_since"),
    status: params.get("status"),
    q: (params.get("q") || "").toLowerCase(),
    page: Math.max(1, Number(params.get("page") || 1)),
    limit: Math.min(100, Math.max(1, Number(params.get("limit") || 20))),
  };
}

export function listTickets(state: DbState, p: ListParams) {
  let result = [...state.tickets];

  if (p.updatedSince) {
    const since = Date.parse(p.updatedSince);

    if (Number.isNaN(since)) throw validationError("updated_since must be an ISO 8601 date");
    result = result.filter((t) => Date.parse(t.updated_at) > since);
  }

  if (p.status) result = result.filter((t) => t.status === p.status);

  if (p.q) {
    result = result.filter((t) =>
      `${t.id} ${t.title} ${t.description}`.toLowerCase().includes(p.q),
    );
  }

  result.sort((a, b) => a.id.localeCompare(b.id));

  const total = result.length;
  const pagination: Pagination = {
    page: p.page,
    limit: p.limit,
    total,
    total_pages: Math.ceil(total / p.limit),
    next_page: p.page * p.limit < total ? p.page + 1 : null,
  };

  return { items: result.slice((p.page - 1) * p.limit, p.page * p.limit), pagination };
}

export const getTicket = (state: DbState, id: string) => requireTicket(state, id);

export function listChildEvents(state: DbState, id: string, kind: "comments" | "history") {
  requireTicket(state, id);

  const type = kind === "comments" ? "comment" : "status_changed";
  const items = state.events
    .filter((e) => e.ticket_id === id && e.type === type)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  return { items, total: items.length };
}

export function listEvents(state: DbState, ticketId: string | null, type: string | null) {
  let items = [...state.events];

  if (ticketId) items = items.filter((e) => e.ticket_id === ticketId);
  if (type) items = items.filter((e) => e.type === type);
  return { items, total: items.length };
}

const isObject = (v: unknown): v is Body => typeof v === "object" && v !== null;

/** The create contract: required fields and allowed values. Shared with the data generator. */
export function validateTicketBody(body: Body): Person {
  const requester = isObject(body.requester) ? (body.requester as Person) : undefined;

  if (!body.title || !requester?.email || !body.status || !body.priority) {
    throw validationError("title, requester.email, status, and priority are required");
  }

  if (!(STATUSES as readonly string[]).includes(body.status as string)) {
    throw validationError(`status ${oneOf(STATUSES)}`);
  }

  if (!(PRIORITIES as readonly string[]).includes(body.priority as string)) {
    throw validationError(`priority ${oneOf(PRIORITIES)}`);
  }

  if (body.tags !== undefined && !Array.isArray(body.tags)) {
    throw validationError("tags must be an array");
  }

  return requester;
}

export function createTicket(state: DbState, body: Body): Ticket {
  const requester = validateTicketBody(body);
  const status = body.status as string;
  const priority = body.priority as string;

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const id = `TCK-${state.nextNum++}`;

  const ticket: Ticket = {
    id,
    title: body.title as string,
    description: (body.description as string | null | undefined) ?? null,
    status: "new",
    priority,
    created_at: now,
    updated_at: now,
    resolved_at: null,
    requester,
    customer: (body.customer as Person | null | undefined) ?? null,
    assignee: (body.assignee as Person | null | undefined) ?? null,
    tags: (body.tags as string[] | undefined) ?? [],
    channel: (body.channel as string | null | undefined) ?? null,
    url: (body.url as string | null | undefined) ?? null,
  };

  state.tickets.unshift(ticket);

  const author: Author = {
    id: requester.id ?? null,
    name: requester.name ?? null,
    role: "customer",
  };

  addEvent(state, id, "created", nowMs, { author, public: true, body: "Ticket created" });

  if (ticket.description) {
    addEvent(state, id, "comment", nowMs + 1, { author, public: true, body: ticket.description });
  }

  setStatus(state, ticket, status, SYSTEM);
  return ticket;
}

const PATCHABLE = [
  "title",
  "description",
  "priority",
  "requester",
  "customer",
  "assignee",
  "tags",
  "channel",
] as const;

export function patchTicket(state: DbState, id: string, patch: Body): Ticket {
  const ticket = requireTicket(state, id);

  if (patch.status !== undefined && !(STATUSES as readonly string[]).includes(patch.status as string)) {
    throw validationError(`status ${oneOf(STATUSES)}`);
  }

  if (patch.priority !== undefined && !(PRIORITIES as readonly string[]).includes(patch.priority as string)) {
    throw validationError(`priority ${oneOf(PRIORITIES)}`);
  }

  if (patch.title !== undefined && !String(patch.title).trim()) {
    throw validationError("title cannot be empty");
  }

  if (
    patch.tags !== undefined &&
    !(Array.isArray(patch.tags) && patch.tags.every((t) => typeof t === "string"))
  ) {
    throw validationError("tags must be an array of strings");
  }

  const target = ticket as unknown as Body;

  for (const key of PATCHABLE) {
    if (patch[key] !== undefined) target[key] = patch[key];
  }

  ticket.updated_at = new Date().toISOString();

  if (patch.status !== undefined) setStatus(state, ticket, patch.status as string);
  return ticket;
}

/**
 * Removes a ticket together with its events (comments, notes, status history),
 * which cannot exist without it. Events of other tickets are untouched.
 */
export function deleteTicket(state: DbState, id: string) {
  requireTicket(state, id);

  const before = state.events.length;

  state.tickets = state.tickets.filter((t) => t.id !== id);
  state.events = state.events.filter((e) => e.ticket_id !== id);
  return { id, deleted: true as const, events_removed: before - state.events.length };
}

export function addComment(state: DbState, body: Body): TicketEvent {
  const ticket = typeof body.ticket_id === "string" ? findTicket(state, body.ticket_id) : undefined;

  if (!ticket) throw validationError("ticket_id must reference an existing ticket");

  if (((body.type as string | undefined) || "comment") !== "comment") {
    throw validationError(
      "only comments can be added; status changes are recorded by PATCH /api/tickets/:id",
    );
  }

  if (!String(body.body || "").trim()) throw validationError("body is required");

  const given = isObject(body.author) ? (body.author as Partial<Author>) : undefined;
  const role = given?.role || "agent";

  if (!(ROLES as readonly string[]).includes(role)) {
    throw validationError(`author.role ${oneOf(ROLES)}`);
  }

  const event = addEvent(state, ticket.id, "comment", Date.now(), {
    author: {
      id: given?.id || (role === "agent" ? "agent-demo" : "requester"),
      name: given?.name || (role === "agent" ? "Demo Agent" : "Customer"),
      role,
    },
    public: body.public !== false,
    body: String(body.body),
  });

  ticket.updated_at = event.created_at;
  return event;
}
