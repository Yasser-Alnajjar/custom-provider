import { agentKey, buildDirectory, customerKey, personKey, requesterKey } from "@/lib/directory";
import type { DbState, PeopleRegistry, Person, PersonKind, PersonRecord } from "@/lib/types";
import { conflict, notFound, validationError } from "./errors";

type Body = Record<string, unknown>;

const SINGULAR: Record<PersonKind, string> = { customers: "Customer", requesters: "Requester", agents: "Agent" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function registry(state: DbState): PeopleRegistry {
  return (state.people ??= { customers: [], requesters: [], agents: [] });
}

function records(state: DbState, kind: PersonKind): PersonRecord[] {
  const reg = registry(state);
  const dir = buildDirectory(state.tickets, state.events, reg);
  const registered = new Set(reg[kind].map((p) => personKey[kind](p)));
  const mk = (key: string, id: string | null | undefined, name: string, email: string | null | undefined, tickets: number, events: number): PersonRecord => ({
    key, id: id ?? null, name, email: email ?? null, tickets, events, registered: registered.has(key),
  });

  if (kind === "customers") return [...dir.customers.values()].map((c) => mk(c.key, c.id, c.name, null, c.tickets.length, 0));
  if (kind === "requesters") return [...dir.requesters.values()].map((r) => mk(r.key, r.id, r.name, r.email, r.tickets.length, r.events.length));
  return [...dir.agents.values()].map((a) => mk(a.id, a.id, a.name, null, a.tickets.length, a.events.length));
}

function require(state: DbState, kind: PersonKind, key: string): PersonRecord {
  const found = records(state, kind).find((r) => r.key === key);

  if (!found) throw notFound(`${SINGULAR[kind]} not found`);
  return found;
}

function str(body: Body, field: string, { required = false, max = 200 } = {}): string | undefined {
  const value = body[field];

  if (value === undefined || value === null || value === "") {
    if (required) throw validationError(`${field} is required`);
    return undefined;
  }

  if (typeof value !== "string") throw validationError(`${field} must be a string`);

  const trimmed = value.trim();

  if (!trimmed && required) throw validationError(`${field} is required`);
  if (trimmed.length > max) throw validationError(`${field} must be at most ${max} characters`);
  return trimmed || undefined;
}

function email(body: Body, required: boolean): string | undefined {
  const value = str(body, "email", { required });

  if (value && !EMAIL.test(value)) throw validationError("email must be a valid email address");
  return value;
}

export function listPeople(state: DbState, kind: PersonKind, q: string) {
  const needle = q.trim().toLowerCase();
  const items = records(state, kind)
    .filter((r) => !needle || [r.name, r.email, r.id].filter(Boolean).join(" ").toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { items, total: items.length };
}

export const getPerson = (state: DbState, kind: PersonKind, key: string) => require(state, kind, key);

export function createPerson(state: DbState, kind: PersonKind, body: Body): PersonRecord {
  const name = str(body, "name", { required: true });
  let person: Person;

  if (kind === "requesters") {
    person = { id: str(body, "id", { max: 100 }) ?? null, name, email: email(body, true) };
  } else {
    let id = str(body, "id", { max: 100 });

    if (kind === "agents") {
      if (id === "system") throw validationError("id system is reserved");
      id ??= `agent-${name!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new"}`;
    }

    person = { id: id ?? null, name };
  }

  if (person.id?.includes("/")) throw validationError("id cannot contain /");

  const key = personKey[kind](person);

  if (records(state, kind).some((r) => r.key === key)) {
    throw conflict(`${SINGULAR[kind]} ${key} already exists`);
  }

  registry(state)[kind].push(person);
  return require(state, kind, key);
}

/** Rewrites every embedded copy of the person so tickets, events and the registry stay consistent. */
export function updatePerson(state: DbState, kind: PersonKind, key: string, body: Body): PersonRecord {
  const current = require(state, kind, key);

  if (body.id !== undefined && body.id !== current.id && !(body.id === null && current.id === null)) {
    throw validationError("id cannot be changed");
  }

  const name = body.name === undefined ? current.name : str(body, "name", { required: true })!;
  const mail = kind === "requesters" && body.email !== undefined ? email(body, true) : current.email;

  if (kind !== "requesters" && body.email !== undefined) throw validationError("email is only supported for requesters");

  const next: Person = { id: current.id, name, ...(kind === "requesters" ? { email: mail } : {}) };
  const nextKey = personKey[kind](next);

  if (nextKey !== key && records(state, kind).some((r) => r.key === nextKey)) {
    throw conflict(`${SINGULAR[kind]} ${nextKey} already exists`);
  }

  const now = new Date().toISOString();

  for (const t of state.tickets) {
    if (kind === "customers" && t.customer && customerKey(t.customer) === key) {
      t.customer = { ...t.customer, name };
      t.updated_at = now;
    }

    if (kind === "requesters" && t.requester && requesterKey(t.requester) === key) {
      t.requester = { ...t.requester, name, email: mail };
      t.updated_at = now;

      for (const e of state.events) {
        if (e.ticket_id === t.id && e.author?.role === "customer") e.author = { ...e.author, name };
      }
    }

    if (kind === "agents" && t.assignee && agentKey(t.assignee) === key) {
      t.assignee = { ...t.assignee, name };
      t.updated_at = now;
    }
  }

  if (kind === "agents") {
    for (const e of state.events) {
      if (e.author?.role === "agent" && e.author.id === key) e.author = { ...e.author, name };
    }
  }

  const list = registry(state)[kind];
  const at = list.findIndex((p) => personKey[kind](p) === key);

  if (at >= 0) list[at] = { ...list[at], ...next };
  return require(state, kind, nextKey);
}

/** Only people nothing refers to can be deleted; ticket history is never rewritten. */
export function deletePerson(state: DbState, kind: PersonKind, key: string) {
  const current = require(state, kind, key);

  if (current.tickets > 0 || (kind === "agents" && current.events > 0)) {
    const refs = [
      current.tickets && `${current.tickets} ticket${current.tickets === 1 ? "" : "s"}`,
      kind === "agents" && current.events && `${current.events} event${current.events === 1 ? "" : "s"}`,
    ].filter(Boolean);

    throw conflict(`${SINGULAR[kind]} ${key} is referenced by ${refs.join(" and ")} and cannot be deleted`);
  }

  const list = registry(state)[kind];

  registry(state)[kind] = list.filter((p) => personKey[kind](p) !== key);
  return { key, deleted: true as const };
}
