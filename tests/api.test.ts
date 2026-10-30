import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The routes read their configuration at import time, so point them at a temp
// database file and a known token before importing.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acmedesk-"));
const DB_FILE = path.join(dir, "db.json");
const AUTH = { Authorization: "Bearer test_token" };

type RouteModule = Record<string, (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>;
let routes: Record<string, RouteModule>;

const url = (p: string) => `http://127.0.0.1:4100${p}`;
const params = (p: Record<string, string> = {}) => ({ params: Promise.resolve(p) });

function call(route: string, method: string, p: string, body?: unknown, headers: Record<string, string> = AUTH, ctx: Record<string, string> = {}) {
  const req = new Request(url(p), {
    method,
    headers: { ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

  return routes[route][method](req, params(ctx));
}

const newTicket = (over: Record<string, unknown> = {}) => ({
  title: "Printer on fire",
  description: "It is smoking",
  status: "open",
  priority: "high",
  requester: { id: "usr-1", name: "Mona", email: "mona@example.com" },
  customer: { id: "cus-1", name: "Acme" },
  tags: ["hw"],
  channel: "email",
  ...over,
});

beforeAll(async () => {
  vi.stubEnv("DB_FILE", DB_FILE);
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("API_TOKEN", "test_token");
  routes = {
    tickets: await import("@/app/api/tickets/route"),
    ticket: await import("@/app/api/tickets/[id]/route"),
    comments: await import("@/app/api/tickets/[id]/comments/route"),
    history: await import("@/app/api/tickets/[id]/history/route"),
    events: await import("@/app/api/events/route"),
    customers: await import("@/app/api/customers/route"),
    customer: await import("@/app/api/customers/[key]/route"),
    requesters: await import("@/app/api/requesters/route"),
    requester: await import("@/app/api/requesters/[key]/route"),
    agents: await import("@/app/api/agents/route"),
    agent: await import("@/app/api/agents/[key]/route"),
    meta: await import("@/app/api/meta/route"),
    reset: await import("@/app/api/reset/route"),
    unknown: await import("@/app/api/[...path]/route"),
    health: await import("@/app/health/route"),
    config: await import("@/app/elapsed-config.json/route"),
  } as unknown as Record<string, RouteModule>;
});

beforeEach(() => fs.rmSync(DB_FILE, { force: true }));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("auth and CORS", () => {
  it("rejects requests without the token", async () => {
    const res = await call("meta", "GET", "/api/meta", undefined, {});

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized", message: "Use Authorization: Bearer <API_TOKEN>." });
  });

  it("accepts the bearer token and X-Api-Key", async () => {
    expect((await call("meta", "GET", "/api/meta")).status).toBe(200);
    expect((await call("meta", "GET", "/api/meta", undefined, { "X-Api-Key": "test_token" })).status).toBe(200);
  });

  it("answers preflight requests and sets CORS headers", async () => {
    const res = routes.meta.OPTIONS(new Request(url("/api/meta"), { method: "OPTIONS" }), params());

    expect((await res).status).toBe(204);
    expect((await res).headers.get("access-control-allow-origin")).toBe("*");
    expect((await call("meta", "GET", "/api/meta")).headers.get("access-control-allow-methods")).toContain("DELETE");
  });

  it("returns 404 JSON for unknown API paths, after auth", async () => {
    expect((await call("unknown", "GET", "/api/nope", undefined, {})).status).toBe(401);
    const res = await call("unknown", "GET", "/api/nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Unknown API endpoint" });
  });

  it("keeps /api/reset disabled", async () => {
    expect((await call("reset", "POST", "/api/reset")).status).toBe(403);
  });
});

describe("tickets", () => {
  it("starts empty and creates tickets from TCK-1001", async () => {
    const empty = await (await call("tickets", "GET", "/api/tickets")).json();

    expect(empty.data.items).toEqual([]);

    const res = await call("tickets", "POST", "/api/tickets", newTicket());
    const { data } = await res.json();

    expect(res.status).toBe(201);
    expect(data.id).toBe("TCK-1001");
    expect(data.status).toBe("open");

    const second = (await (await call("tickets", "POST", "/api/tickets", newTicket())).json()).data;

    expect(second.id).toBe("TCK-1002");
  });

  it("records created, opening comment and status events", async () => {
    await call("tickets", "POST", "/api/tickets", newTicket());

    const events = (await (await call("events", "GET", "/api/events?ticket_id=TCK-1001")).json()).data;

    expect(events.items.map((e: { type: string }) => e.type)).toEqual(["created", "comment", "status_changed"]);
    expect(events.items[2]).toMatchObject({ from: "new", to: "open", public: false, author: { role: "system" } });
  });

  it("validates input with the documented messages", async () => {
    const missing = await call("tickets", "POST", "/api/tickets", { title: "x" });

    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "validation_error", message: "title, requester.email, status, and priority are required" });

    const status = await call("tickets", "POST", "/api/tickets", newTicket({ status: "bogus" }));

    expect((await status.json()).message).toBe("status must be one of new, open, pending, in_progress, solved, closed");
    expect((await (await call("tickets", "POST", "/api/tickets", newTicket({ priority: "x" }))).json()).message).toBe("priority must be one of low, normal, high, urgent");
    expect((await (await call("tickets", "POST", "/api/tickets", newTicket({ tags: "a" }))).json()).message).toBe("tags must be an array");
  });

  it("rejects malformed JSON with bad_request", async () => {
    const res = await call("tickets", "POST", "/api/tickets", "{nope");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request", message: "Invalid JSON" });
  });

  it("paginates, filters and searches", async () => {
    for (let i = 0; i < 5; i++) await call("tickets", "POST", "/api/tickets", newTicket({ title: `T${i}`, status: i < 2 ? "solved" : "open" }));

    const page = (await (await call("tickets", "GET", "/api/tickets?page=2&limit=2")).json()).data;

    expect(page.items.map((t: { id: string }) => t.id)).toEqual(["TCK-1003", "TCK-1004"]);
    expect(page.pagination).toEqual({ page: 2, limit: 2, total: 5, total_pages: 3, next_page: 3 });
    expect((await (await call("tickets", "GET", "/api/tickets?status=solved")).json()).data.pagination.total).toBe(2);
    expect((await (await call("tickets", "GET", "/api/tickets?q=t3")).json()).data.items).toHaveLength(1);
    expect((await call("tickets", "GET", "/api/tickets?updated_since=nope")).status).toBe(400);
    expect((await (await call("tickets", "GET", "/api/tickets?updated_since=2999-01-01T00:00:00Z")).json()).data.items).toEqual([]);
  });

  it("returns 404 for a missing ticket", async () => {
    const res = await call("ticket", "GET", "/api/tickets/TCK-9", undefined, AUTH, { id: "TCK-9" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Ticket not found" });
    expect((await call("comments", "GET", "/api/tickets/TCK-9/comments", undefined, AUTH, { id: "TCK-9" })).status).toBe(404);
  });

  it("DELETE removes the ticket and only its own events", async () => {
    await call("tickets", "POST", "/api/tickets", newTicket());
    await call("tickets", "POST", "/api/tickets", newTicket({ title: "Keep me" }));
    const before = (await (await call("events", "GET", "/api/events?ticket_id=TCK-1001")).json()).data.total;
    const other = (await (await call("events", "GET", "/api/events?ticket_id=TCK-1002")).json()).data.total;

    const res = await call("ticket", "DELETE", "/api/tickets/TCK-1001", undefined, AUTH, { id: "TCK-1001" });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "TCK-1001", deleted: true, events_removed: before });
    expect((await call("ticket", "GET", "/api/tickets/TCK-1001", undefined, AUTH, { id: "TCK-1001" })).status).toBe(404);
    expect((await (await call("events", "GET", "/api/events?ticket_id=TCK-1001")).json()).data.total).toBe(0);
    expect((await (await call("events", "GET", "/api/events?ticket_id=TCK-1002")).json()).data.total).toBe(other);
    expect((await (await call("tickets", "GET", "/api/tickets")).json()).data.pagination.total).toBe(1);
  });

  it("DELETE requires auth and a known ticket, and never reuses ids", async () => {
    await call("tickets", "POST", "/api/tickets", newTicket());

    expect((await call("ticket", "DELETE", "/api/tickets/TCK-1001", undefined, {}, { id: "TCK-1001" })).status).toBe(401);
    expect((await call("ticket", "GET", "/api/tickets/TCK-1001", undefined, AUTH, { id: "TCK-1001" })).status).toBe(200);
    expect((await call("ticket", "DELETE", "/api/tickets/TCK-9", undefined, AUTH, { id: "TCK-9" })).status).toBe(404);

    await call("ticket", "DELETE", "/api/tickets/TCK-1001", undefined, AUTH, { id: "TCK-1001" });
    expect((await call("ticket", "DELETE", "/api/tickets/TCK-1001", undefined, AUTH, { id: "TCK-1001" })).status).toBe(404);
    expect((await (await call("tickets", "POST", "/api/tickets", newTicket())).json()).data.id).toBe("TCK-1002");
  });

  it("PATCH sets resolved_at, records history, and clears it on reopen", async () => {
    await call("tickets", "POST", "/api/tickets", newTicket());

    const solved = (await (await call("ticket", "PATCH", "/api/tickets/TCK-1001", { status: "solved" }, AUTH, { id: "TCK-1001" })).json()).data;

    expect(solved.status).toBe("solved");
    expect(solved.resolved_at).toBeTruthy();

    const closed = (await (await call("ticket", "PATCH", "/api/tickets/TCK-1001", { status: "closed" }, AUTH, { id: "TCK-1001" })).json()).data;

    expect(closed.resolved_at).toBe(solved.resolved_at);

    const reopened = (await (await call("ticket", "PATCH", "/api/tickets/TCK-1001", { status: "open" }, AUTH, { id: "TCK-1001" })).json()).data;

    expect(reopened.resolved_at).toBeNull();

    const history = (await (await call("history", "GET", "/api/tickets/TCK-1001/history", undefined, AUTH, { id: "TCK-1001" })).json()).data;

    expect(history.items.map((h: { from: string; to: string }) => `${h.from}>${h.to}`)).toEqual(["new>open", "open>solved", "solved>closed", "closed>open"]);
  });

  it("PATCH validates and applies field changes", async () => {
    await call("tickets", "POST", "/api/tickets", newTicket());

    const patch = (body: unknown) => call("ticket", "PATCH", "/api/tickets/TCK-1001", body, AUTH, { id: "TCK-1001" });

    expect((await (await patch({ title: "  " })).json()).message).toBe("title cannot be empty");
    expect((await (await patch({ tags: [1] })).json()).message).toBe("tags must be an array of strings");
    expect((await patch({ status: "nope" })).status).toBe(400);

    const ok = (await (await patch({ title: "New", priority: "low", assignee: { id: "a1", name: "Omar" } })).json()).data;

    expect(ok).toMatchObject({ title: "New", priority: "low", assignee: { id: "a1", name: "Omar" } });
  });
});

describe("comments", () => {
  beforeEach(async () => {
    await call("tickets", "POST", "/api/tickets", newTicket());
  });

  it("adds public comments and internal notes", async () => {
    const note = await call("events", "POST", "/api/events", { ticket_id: "TCK-1001", body: "Secret", public: false, author: { name: "Omar", role: "agent" } });

    expect(note.status).toBe(201);
    expect((await note.json()).data).toMatchObject({ type: "comment", public: false, author: { name: "Omar", role: "agent" } });

    const comments = (await (await call("comments", "GET", "/api/tickets/TCK-1001/comments", undefined, AUTH, { id: "TCK-1001" })).json()).data;

    expect(comments.items).toHaveLength(2); // opening comment + note
    expect(comments.total).toBe(2);
  });

  it("validates comments", async () => {
    const post = async (body: unknown) => (await (await call("events", "POST", "/api/events", body)).json()).message;

    expect(await post({ ticket_id: "nope", body: "x" })).toBe("ticket_id must reference an existing ticket");
    expect(await post({ ticket_id: "TCK-1001", body: "  " })).toBe("body is required");
    expect(await post({ ticket_id: "TCK-1001", body: "x", author: { role: "boss" } })).toBe("author.role must be one of customer, agent, system");
    expect(await post({ ticket_id: "TCK-1001", body: "x", type: "status_changed" })).toContain("only comments can be added");
  });
});

describe("health and Elapsed config", () => {
  it("serves /health without auth", async () => {
    const res = routes.health.GET(new Request(url("/health")), params());

    expect(await (await res).json()).toEqual({ ok: true, provider: "Acme Desk (Demo)", version: "1.1.0" });
  });

  it("derives the base URL from forwarded headers and prefers 127.0.0.1", async () => {
    const forwarded = await routes.config.GET(new Request(url("/elapsed-config.json"), { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "app.vercel.app" } }), params());
    const local = await routes.config.GET(new Request("http://localhost:4100/elapsed-config.json", { headers: { host: "localhost:4100" } }), params());

    expect((await forwarded.json()).connection.baseUrl).toBe("https://app.vercel.app");

    const cfg = await local.json();

    expect(cfg.connection.baseUrl).toBe("http://127.0.0.1:4100");
    expect(cfg.valueMaps.status.pending).toBe("pending_customer");
    expect(cfg.tickets.request.path).toBe("/api/tickets");
  });
});

describe("PATCH ordering", () => {
  it("reports a missing ticket before a malformed body", async () => {
    const res = await call("ticket", "PATCH", "/api/tickets/TCK-9", "{bad", AUTH, { id: "TCK-9" });

    expect(res.status).toBe(404);
  });
});

describe("people (customers, requesters, agents)", () => {
  const item = (kind: string, method: string, key: string, body?: unknown, headers: Record<string, string> = AUTH) =>
    call(kind, method, `/api/${kind}s/${encodeURIComponent(key)}`, body, headers, { key });
  const list = async (kind: string, q = "") => (await (await call(`${kind}s`, "GET", `/api/${kind}s${q}`)).json()).data;

  it("requires auth on every route", async () => {
    expect((await call("customers", "GET", "/api/customers", undefined, {})).status).toBe(401);
    expect((await call("agents", "POST", "/api/agents", { name: "A" }, {})).status).toBe(401);
    expect((await item("requester", "DELETE", "x@y.io", undefined, {})).status).toBe(401);
  });

  it("creates, reads, updates and deletes a customer that has no tickets", async () => {
    const created = await call("customers", "POST", "/api/customers", { id: "cus-9", name: " Globex " });

    expect(created.status).toBe(201);
    expect((await created.json()).data).toMatchObject({ key: "cus-9", name: "Globex", tickets: 0, registered: true });
    expect((await list("customer")).items).toHaveLength(1);
    expect((await list("customer", "?q=glob")).total).toBe(1);
    expect((await list("customer", "?q=nope")).total).toBe(0);

    const patched = await item("customer", "PATCH", "cus-9", { name: "Globex Corp" });

    expect((await patched.json()).data.name).toBe("Globex Corp");
    expect((await (await item("customer", "GET", "cus-9")).json()).data.name).toBe("Globex Corp");
    expect((await item("customer", "DELETE", "cus-9")).status).toBe(200);
    expect((await item("customer", "GET", "cus-9")).status).toBe(404);
  });

  it("validates input and rejects duplicates", async () => {
    const bad = async (kind: string, body: unknown, msg: string) => {
      const res = await call(`${kind}s`, "POST", `/api/${kind}s`, body);

      expect(res.status).toBe(400);
      expect((await res.json()).message).toContain(msg);
    };

    await bad("customer", {}, "name is required");
    await bad("customer", { name: "   " }, "name is required");
    await bad("customer", { name: 5 }, "name must be a string");
    await bad("requester", { name: "Sam" }, "email is required");
    await bad("requester", { name: "Sam", email: "nope" }, "valid email");
    await bad("agent", { name: "Root", id: "system" }, "reserved");
    await bad("agent", { name: "A", id: "a/b" }, "cannot contain /");

    expect((await call("agents", "POST", "/api/agents", { name: "Sam Lee" })).status).toBe(201);
    expect((await (await call("agents", "GET", "/api/agents")).json()).data.items[0].key).toBe("agent-sam-lee");
    expect((await call("agents", "POST", "/api/agents", { name: "Sam Lee" })).status).toBe(409);
    expect((await call("requesters", "POST", "/api/requesters", { name: "A", email: "A@x.io" })).status).toBe(201);
    expect((await call("requesters", "POST", "/api/requesters", { name: "B", email: "a@X.io" })).status).toBe(409);
    expect((await item("agent", "GET", "ghost")).status).toBe(404);
    expect((await item("agent", "PATCH", "ghost", "{bad")).status).toBe(404);
    expect((await item("agent", "PATCH", "agent-sam-lee", "{bad")).status).toBe(400);
    expect((await item("agent", "PATCH", "agent-sam-lee", { id: "other" })).status).toBe(400);
    expect((await item("agent", "PATCH", "agent-sam-lee", { name: "" })).status).toBe(400);
    expect((await item("agent", "PATCH", "agent-sam-lee", { email: "a@b.io" })).status).toBe(400);
  });

  it("derives people from tickets and propagates edits to tickets and events", async () => {
    await call("tickets", "POST", "/api/tickets", newTicket({ assignee: { id: "ag-1", name: "Ann" } }));
    await call("events", "POST", "/api/events", { ticket_id: "TCK-1001", body: "hi", author: { id: "ag-1", name: "Ann", role: "agent" } });

    expect((await list("customer")).items[0]).toMatchObject({ key: "cus-1", tickets: 1, registered: false });
    expect((await list("requester")).items[0]).toMatchObject({ key: "mona@example.com", tickets: 1 });
    expect((await list("agent")).items[0]).toMatchObject({ key: "ag-1", tickets: 1 });

    await item("customer", "PATCH", "cus-1", { name: "Acme Inc" });
    await item("requester", "PATCH", "mona@example.com", { name: "Mona K", email: "mona.k@example.com" });
    await item("agent", "PATCH", "ag-1", { name: "Ann B" });

    const t = (await (await call("ticket", "GET", "/api/tickets/TCK-1001", undefined, AUTH, { id: "TCK-1001" })).json()).data;

    expect(t.customer).toEqual({ id: "cus-1", name: "Acme Inc" });
    expect(t.requester).toMatchObject({ name: "Mona K", email: "mona.k@example.com" });
    expect(t.assignee.name).toBe("Ann B");

    const events = (await (await call("events", "GET", "/api/events?ticket_id=TCK-1001")).json()).data.items;

    expect(events.filter((e: { author: { role: string; name: string } }) => e.author.role === "agent").every((e: { author: { name: string } }) => e.author.name === "Ann B")).toBe(true);
    expect(events.filter((e: { author: { role: string; name: string } }) => e.author.role === "customer").every((e: { author: { name: string } }) => e.author.name === "Mona K")).toBe(true);
    expect((await list("requester")).items.map((r: { key: string }) => r.key)).toEqual(["mona.k@example.com"]);
  });

  it("refuses to delete people that tickets or history refer to", async () => {
    await call("tickets", "POST", "/api/tickets", newTicket({ assignee: { id: "ag-1", name: "Ann" } }));

    for (const [kind, key] of [["customer", "cus-1"], ["requester", "mona@example.com"], ["agent", "ag-1"]]) {
      const res = await item(kind, "DELETE", key);

      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("conflict");
      expect((await item(kind, "GET", key)).status).toBe(200);
    }

    await call("ticket", "DELETE", "/api/tickets/TCK-1001", undefined, AUTH, { id: "TCK-1001" });
    // Nothing refers to them any more, but they were never registered, so they vanish with the ticket.
    expect((await item("customer", "GET", "cus-1")).status).toBe(404);
  });

  it("blocks renames that collide with an existing person", async () => {
    await call("customers", "POST", "/api/customers", { name: "One" });
    await call("customers", "POST", "/api/customers", { name: "Two" });
    expect((await item("customer", "PATCH", "One", { name: "Two" })).status).toBe(409);
  });
});
