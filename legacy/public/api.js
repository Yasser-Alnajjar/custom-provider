// The only module that talks to the provider API. Everything it returns is
// the server's own response; nothing is mocked or defaulted here.

export const DEFAULT_TOKEN = "demo_elapsed";
const TOKEN_KEY = "acmedesk.token";
const ACTOR_KEY = "acmedesk.actor";

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable (private mode); the session just won't persist */
  }
}

export const getToken = () => read(TOKEN_KEY) || DEFAULT_TOKEN;
export const setToken = (token) => write(TOKEN_KEY, token && token !== DEFAULT_TOKEN ? token : null);

// The server has no user accounts, so "who am I" is a local choice used as the
// author of comments written from this UI.
export function getActor() {
  try {
    const actor = JSON.parse(read(ACTOR_KEY) || "null");
    if (actor?.name) return { id: actor.id || undefined, name: actor.name, role: "agent" };
  } catch {
    /* fall through to the default */
  }
  return { id: "agent-demo", name: "Demo Agent", role: "agent" };
}
export const setActor = (actor) => write(ACTOR_KEY, actor ? JSON.stringify(actor) : null);

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

export async function api(path, { method = "GET", body, auth = true } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(auth ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    emit("api-status", { online: false });
    throw new ApiError(`Could not reach the server at ${location.origin}`, 0, "network");
  }
  emit("api-status", { online: true });
  const data = await res.json().catch(() => null);
  if (res.status === 401) emit("auth-error");
  if (!res.ok)
    throw new ApiError(data?.message || `HTTP ${res.status}`, res.status, data?.error);
  if (!data) throw new ApiError("Unexpected response from the server", res.status);
  return data;
}

const enc = encodeURIComponent;
const items = (res) => {
  if (!Array.isArray(res?.data?.items)) throw new ApiError("Unexpected response shape from the server");
  return res.data.items;
};

// GET /api/tickets, following the server's pagination until next_page is null.
export async function listAllTickets() {
  const all = [];
  let page = 1;
  for (let guard = 0; page && guard < 200; guard++) {
    const res = await api(`/api/tickets?page=${page}&limit=100`);
    all.push(...items(res));
    page = res.data.pagination?.next_page || null;
  }
  return all;
}
export const getTicket = async (id) => (await api(`/api/tickets/${enc(id)}`)).data;
export const getComments = async (id) => items(await api(`/api/tickets/${enc(id)}/comments`));
export const getHistory = async (id) => items(await api(`/api/tickets/${enc(id)}/history`));
export const getEvents = async (params = {}) => {
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== ""),
  ).toString();
  return items(await api(`/api/events${q ? `?${q}` : ""}`));
};
export const createTicket = async (body) => (await api("/api/tickets", { method: "POST", body })).data;
export const patchTicket = async (id, patch) =>
  (await api(`/api/tickets/${enc(id)}`, { method: "PATCH", body: patch })).data;
// POST /api/events adds a comment; `public: false` makes it an internal note.
export const addComment = async ({ ticket_id, body, author, isPublic }) =>
  (
    await api("/api/events", {
      method: "POST",
      body: { ticket_id, body, author, public: isPublic },
    })
  ).data;

export const getMeta = () => api("/api/meta");
export const getHealth = () => api("/health", { auth: false });
export async function getElapsedConfig() {
  const res = await fetch("/elapsed-config.json");
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return res.json();
}
