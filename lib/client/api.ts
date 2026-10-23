import type { Pagination, Ticket, TicketEvent } from "@/lib/types";
import { getToken } from "./storage";

// The only module that talks to the provider API. Everything it returns is the
// server's own response; nothing is mocked or defaulted here.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Listener = (event: "online" | "offline" | "unauthorized") => void;
const listeners = new Set<Listener>();

export function onApiEvent(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const emit = (event: Parameters<Listener>[0]) => listeners.forEach((fn) => fn(event));

interface Options {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export async function api<T>(path: string, { method = "GET", body, auth = true }: Options = {}): Promise<T> {
  let res: Response;

  try {
    res = await fetch(path, {
      method,
      cache: "no-store",
      headers: {
        ...(auth ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    emit("offline");
    throw new ApiError(`Could not reach the server at ${location.origin}`, 0, "network");
  }

  emit("online");

  const data = (await res.json().catch(() => null)) as (T & { message?: string; error?: string }) | null;

  if (res.status === 401) emit("unauthorized");
  if (!res.ok) throw new ApiError(data?.message || `HTTP ${res.status}`, res.status, data?.error);
  if (!data) throw new ApiError("Unexpected response from the server", res.status);
  return data;
}

const enc = encodeURIComponent;

interface ItemsResponse<T> {
  data: { items: T[]; pagination?: Pagination };
}

function items<T>(res: ItemsResponse<T>): T[] {
  if (!Array.isArray(res?.data?.items)) throw new ApiError("Unexpected response shape from the server");
  return res.data.items;
}

/** GET /api/tickets, following the server's pagination until next_page is null. */
export async function listAllTickets(): Promise<Ticket[]> {
  const all: Ticket[] = [];
  let page: number | null = 1;

  for (let guard = 0; page && guard < 200; guard++) {
    const res: ItemsResponse<Ticket> = await api(`/api/tickets?page=${page}&limit=100`);

    all.push(...items(res));
    page = res.data.pagination?.next_page || null;
  }

  return all;
}

export const getTicket = async (id: string) => (await api<{ data: Ticket }>(`/api/tickets/${enc(id)}`)).data;
export const getComments = async (id: string) =>
  items(await api<ItemsResponse<TicketEvent>>(`/api/tickets/${enc(id)}/comments`));
export const getHistory = async (id: string) =>
  items(await api<ItemsResponse<TicketEvent>>(`/api/tickets/${enc(id)}/history`));

export async function getEvents(params: Record<string, string> = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "")).toString();
  return items(await api<ItemsResponse<TicketEvent>>(`/api/events${q ? `?${q}` : ""}`));
}

export const createTicket = async (body: Record<string, unknown>) =>
  (await api<{ data: Ticket }>("/api/tickets", { method: "POST", body })).data;

export const patchTicket = async (id: string, patch: Record<string, unknown>) =>
  (await api<{ data: Ticket }>(`/api/tickets/${enc(id)}`, { method: "PATCH", body: patch })).data;

/** POST /api/events adds a comment; `public: false` makes it an internal note. */
export const addComment = async (input: {
  ticket_id: string;
  body: string;
  author: unknown;
  isPublic: boolean;
}) =>
  (
    await api<{ data: TicketEvent }>("/api/events", {
      method: "POST",
      body: { ticket_id: input.ticket_id, body: input.body, author: input.author, public: input.isPublic },
    })
  ).data;

export const getMeta = () =>
  api<{ provider: string; api_version: string; capabilities: string[]; auth: string }>("/api/meta");
export const getHealth = () =>
  api<{ ok: boolean; provider: string; version: string }>("/health", { auth: false });

export async function getElapsedConfig(): Promise<unknown> {
  const res = await fetch("/elapsed-config.json");
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return res.json();
}
