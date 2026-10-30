import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { firstResponseMs } from "@/lib/ticket-metrics";
import { PRIORITIES, STATUSES, type GenerationProgress, type Ticket, type TicketEvent } from "@/lib/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acmedesk-gen-"));
const DB_FILE = path.join(dir, "db.json");
const AUTH = { Authorization: "Bearer test_token" };

type Route = Record<string, (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>;
let r: Record<string, Route>;
let gen: typeof import("@/lib/server/generator");
let db: typeof import("@/lib/server/db");
let tickets: typeof import("@/lib/server/tickets");

async function call(route: string, method: string, body?: unknown, ctx: Record<string, string> = {}, headers: Record<string, string> = AUTH) {
  const req = new Request("http://127.0.0.1:4100/api/x", {
    method,
    headers: { ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await r[route][method](req, { params: Promise.resolve(ctx) });

  return { status: res.status, body: (await res.json()) as any };
}

let n = 0;
const start = (count: number, key = `test-key-${++n}-${Math.random()}`) => call("jobs", "POST", { count, idempotency_key: key });
const advance = (id: string) => call("advance", "POST", undefined, { id });
const addReal = () =>
  db.withDb(true, (s) => {
    tickets.createTicket(s, { title: "Real", description: "x", status: "open", priority: "low", requester: { email: "real@example.com" } });
  });
const read = () => db.withDb(false, (s) => s);

async function runAll(id: string) {
  let job: GenerationProgress;

  do job = (await advance(id)).body.data;
  while (job.status === "running");
  return job;
}

beforeAll(async () => {
  vi.stubEnv("DB_FILE", DB_FILE);
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("API_TOKEN", "test_token");
  vi.stubEnv("GENERATOR_MAX_TICKETS", "300");
  vi.stubEnv("GENERATOR_BATCH_SIZE", "40");
  vi.stubEnv("GENERATOR_MAX_TOTAL", "500");
  db = await import("@/lib/server/db");
  gen = await import("@/lib/server/generator");
  tickets = await import("@/lib/server/tickets");
  r = {
    jobs: await import("@/app/api/generator/jobs/route"),
    job: await import("@/app/api/generator/jobs/[id]/route"),
    advance: await import("@/app/api/generator/jobs/[id]/advance/route"),
    cancel: await import("@/app/api/generator/jobs/[id]/cancel/route"),
    resume: await import("@/app/api/generator/jobs/[id]/resume/route"),
    purge: await import("@/app/api/generator/synthetic/route"),
    tickets: await import("@/app/api/tickets/route"),
  } as unknown as Record<string, Route>;
});

beforeEach(() => {
  fs.rmSync(DB_FILE, { force: true });
  vi.stubEnv("GENERATOR_ENABLED", "1");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("authorization", () => {
  it("rejects every generator endpoint without the token", async () => {
    expect((await call("jobs", "GET", undefined, {}, {})).status).toBe(401);
    expect((await call("jobs", "POST", { count: 5, idempotency_key: "abcdefgh" }, {}, {})).status).toBe(401);
    expect((await call("advance", "POST", undefined, { id: "gen-1" }, {})).status).toBe(401);
    expect((await call("purge", "DELETE", undefined, {}, {})).status).toBe(401);
    expect((await read()).tickets).toHaveLength(0);
  });

  it("can be switched off", async () => {
    vi.stubEnv("GENERATOR_ENABLED", "0");
    expect((await start(5)).status).toBe(403);
  });
});

describe("input validation", () => {
  it.each([0, -1, 301, 1.5, "10", null, undefined, NaN])("rejects count %s", async (count) => {
    const res = await call("jobs", "POST", { count, idempotency_key: "valid-key-1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("accepts the maximum and rejects a bad idempotency key", async () => {
    expect((await start(300)).status).toBe(201);
    expect((await call("jobs", "POST", { count: 5, idempotency_key: "x" })).status).toBe(400);
    expect((await call("jobs", "POST", { count: 5 })).status).toBe(400);
  });

  it("reports the configured limits", async () => {
    const { body } = await call("jobs", "GET");

    expect(body.data.limits).toEqual({ enabled: true, maxTickets: 300, batchSize: 40, maxTotal: 500 });
  });

  it("enforces the total synthetic ticket budget", async () => {
    await runAll((await start(300)).body.data.id);
    expect((await start(200)).status).toBe(201); // 500 total is allowed
    await runAll("gen-2");
    expect((await start(1)).status).toBe(400);
  });
});

describe("generation", () => {
  it("generates exactly the requested count in bounded batches", async () => {
    const created = await start(100);

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "running", requested: 100, generated: 0, remaining: 100 });

    const sizes: number[] = [];
    let before = 0;
    let job: GenerationProgress;

    do {
      job = (await advance(created.body.data.id)).body.data;
      sizes.push(job.processed - before);
      before = job.processed;
    } while (job.status === "running");

    expect(sizes).toEqual([40, 40, 20]);
    expect(job).toMatchObject({ status: "completed", generated: 100, processed: 100, failed: 0, remaining: 0, batches: 3 });
    expect((await read()).tickets).toHaveLength(100);
    expect(new Set((await read()).tickets.map((t) => t.id)).size).toBe(100);
  });

  it("produces tickets that follow the API contract and are marked synthetic", async () => {
    await runAll((await start(60)).body.data.id);

    const state = await read();
    const list = (await call("tickets", "GET")).body.data;

    expect(list.pagination.total).toBe(60);

    for (const t of state.tickets) {
      expect(t.id).toMatch(/^SYN-1-\d{5}$/);
      expect(t.tags).toContain("synthetic");
      expect(t.title.startsWith("[SYNTHETIC]")).toBe(true);
      expect(t.requester?.email).toMatch(/@synthetic\.invalid$/);
      expect(STATUSES).toContain(t.status);
      expect(PRIORITIES).toContain(t.priority);
      expect(Date.parse(t.created_at)).toBeLessThanOrEqual(Date.parse(t.updated_at));
      expect(Date.parse(t.updated_at)).toBeLessThanOrEqual(Date.now());
    }
  });

  it("has internally consistent histories that the metrics can use", async () => {
    await runAll((await start(120)).body.data.id);

    const state = await read();
    let withReply = 0;

    for (const t of state.tickets as Ticket[]) {
      const events = state.events.filter((e) => e.ticket_id === t.id);
      const times = events.map((e) => Date.parse(e.created_at));
      const history = events.filter((e) => e.type === "status_changed");
      const comments = events.filter((e) => e.type === "comment");

      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(events.filter((e) => e.type === "created")).toHaveLength(1);
      expect(Date.parse(t.updated_at)).toBeGreaterThanOrEqual(Math.max(...times)); // stamped when written
      expect(history.at(-1)?.to ?? "new").toBe(t.status);

      let from = "new";

      for (const h of history) {
        expect(h.from).toBe(from);
        from = h.to!;
      }

      const resolved = history.find((h) => ["solved", "closed"].includes(h.to!));

      expect(t.resolved_at).toBe(resolved?.created_at ?? null);
      expect(Boolean(t.assignee)).toBe(t.status !== "new");

      const ms = firstResponseMs(t, comments as TicketEvent[]);

      if (t.status !== "new") {
        expect(ms).not.toBeNull();
        withReply++;
      }
    }

    expect(withReply).toBeGreaterThan(0);
    expect(new Set(state.tickets.map((t) => t.status)).size).toBeGreaterThan(3);
  });

  it("is available through the normal ingestion endpoints (updated_since, comments, history)", async () => {
    await runAll((await start(60)).body.data.id);

    const list = async (q: string) => {
      const req = new Request(`http://127.0.0.1:4100/api/tickets?${q}`, { headers: AUTH });

      return ((await (await r.tickets.GET(req, { params: Promise.resolve({}) })).json()) as any).data;
    };

    expect((await list("limit=100")).items).toHaveLength(60);
    expect((await list("updated_since=2000-01-01T00:00:00Z&limit=100")).items).toHaveLength(60);
    expect((await list("updated_since=2999-01-01T00:00:00Z")).items).toHaveLength(0);

    const sample = (await read()).tickets.find((t) => t.status === "closed")!;
    const comments = tickets.listChildEvents(await read(), sample.id, "comments");
    const history = tickets.listChildEvents(await read(), sample.id, "history");

    expect(comments.items.length).toBeGreaterThan(1);
    expect(history.items.map((h) => h.to)).toEqual(["open", "in_progress", "solved", "closed"]);
  });

  it("leaves real tickets untouched", async () => {
    await addReal();
    const before = JSON.stringify((await read()).tickets);

    await runAll((await start(20)).body.data.id);

    const state = await read();

    expect(JSON.stringify(state.tickets.filter((t) => !t.id.startsWith("SYN-")))).toBe(before);
    expect(state.tickets).toHaveLength(21);
  });
});

describe("idempotency and retries", () => {
  it("returns the same job for a repeated key and creates no second job", async () => {
    const a = await start(50, "same-key-12345");
    const b = await start(50, "same-key-12345");

    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.reused).toBe(true);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect((await call("jobs", "GET")).body.data.total).toBe(1);
    expect((await start(60, "same-key-12345")).status).toBe(409);
  });

  it("allows only one running job", async () => {
    await start(50);
    expect((await start(50)).status).toBe(409);
  });

  it("does not duplicate tickets when a batch is repeated", async () => {
    const id = (await start(80)).body.data.id;

    // Concurrent advance calls are serialised; together they still produce each batch once.
    await Promise.all([advance(id), advance(id), advance(id)]);

    const job = (await call("job", "GET", undefined, { id })).body.data;

    expect(job.processed).toBe(job.generated);
    expect(job.status).toBe("completed");
    expect(job.processed).toBe(80);
    expect(new Set((await read()).tickets.map((t) => t.id)).size).toBe(80);
    expect((await advance(id)).body.data.processed).toBe(80); // advancing a finished job is a no-op
  });

  it("is a no-op for tickets already present when the cursor lagged behind", async () => {
    const id = (await start(40)).body.data.id;

    await db.withDb(true, (s) => {
      gen.advanceJob(s, id);
      s.generation!.jobs[0].cursor = 0; // simulate a crash before the cursor was saved
      s.generation!.jobs[0].generated = 0;
      s.generation!.jobs[0].status = "running";
      gen.advanceJob(s, id);
    });

    const state = await read();

    expect(state.tickets).toHaveLength(40);
    expect(state.generation!.jobs[0]).toMatchObject({ generated: 40, status: "completed" });
  });
});

describe("partial failures and recovery", () => {
  it("records failures, marks the job failed after repeated attempts, and resumes from the cursor", async () => {
    const id = (await start(80)).body.data.id;

    await advance(id);

    const events = (await read()).events.length;
    const spy = vi.spyOn(await import("@/lib/generator"), "planTicket").mockImplementation(() => {
      throw new Error("boom");
    });

    for (let i = 0; i < 3; i++) await expect(advance(id)).rejects.toThrow("boom");
    spy.mockRestore();

    let job = (await call("job", "GET", undefined, { id })).body.data as GenerationProgress;

    expect(job).toMatchObject({ status: "failed", attempts: 3, error: "boom", cursor: 40, processed: 40 });
    expect((await read()).events.length).toBe(events); // the failed batches wrote nothing

    expect((await call("resume", "POST", undefined, { id })).body.data.status).toBe("running");
    job = await runAll(id);
    expect(job).toMatchObject({ status: "completed", generated: 80, processed: 80, failed: 0 });
    expect(new Set((await read()).tickets.map((t) => t.id)).size).toBe(80);
  });

  it("counts tickets that fail contract validation as failed instead of inserting them", async () => {
    const id = (await start(20)).body.data.id;
    const mod = await import("@/lib/generator");
    const real = mod.planTicket;

    vi.spyOn(mod, "planTicket").mockImplementation((input) => {
      const plan = real(input);

      if (input.index % 5 === 0) plan.ticket.status = "bogus";
      return plan;
    });

    const job = await runAll(id);

    vi.restoreAllMocks();
    expect(job).toMatchObject({ status: "failed", generated: 16, failed: 4, processed: 16, remaining: 0 });
    expect((await call("resume", "POST", undefined, { id })).status).toBe(409);
  });
});

describe("stop and resume", () => {
  it("cancels a running job, keeps what was written, and resumes to the exact count", async () => {
    const id = (await start(100)).body.data.id;

    await advance(id);

    const cancelled = (await call("cancel", "POST", undefined, { id })).body.data;

    expect(cancelled).toMatchObject({ status: "cancelled", processed: 40, remaining: 60 });
    expect((await advance(id)).body.data.processed).toBe(40); // cancelled jobs do not advance

    expect((await start(10)).status).toBe(201); // a new job may start while the old one is stopped

    expect((await call("resume", "POST", undefined, { id })).status).toBe(409); // but only one runs at a time
    await runAll("gen-2");

    const job = (await call("resume", "POST", undefined, { id })).body.data;

    expect(job.status).toBe("running");
    expect(await runAll(id)).toMatchObject({ status: "completed", processed: 100 });
  });

  it("404s unknown jobs", async () => {
    expect((await advance("gen-99")).status).toBe(404);
    expect((await call("job", "GET", undefined, { id: "nope" })).status).toBe(404);
  });
});

describe("isolation and cleanup", () => {
  it("purge removes only synthetic tickets and their events", async () => {
    await addReal();
    await runAll((await start(30)).body.data.id);

    expect((await call("purge", "DELETE")).body.data).toEqual({ deleted: 30 });

    const state = await read();

    expect(state.tickets.map((t) => t.title)).toEqual(["Real"]);
    expect(state.events.every((e) => !e.ticket_id.startsWith("SYN-"))).toBe(true);
  });

  it("refuses to purge while a job is running", async () => {
    await start(30);
    expect((await call("purge", "DELETE")).status).toBe(409);
  });
});
