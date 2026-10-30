/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Regression tests for "generated tickets never show up in Elapsed".
//
// Elapsed syncs incrementally (packages/custom-ticket/src/ingest.ts): a pass asks for
// `updated_since=<watermark>`, and when it completes the watermark becomes
// `<pass start> - lookbackSeconds`. A ticket whose `updated_at` is older than the watermark
// is never listed again. The generator used to back-date `updated_at` along with the rest of
// the history, so tickets generated after the first pass were invisible.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acmedesk-ing-"));
const DB_FILE = path.join(dir, "db.json");
const AUTH = { Authorization: "Bearer test_token" };
const LOOKBACK_MS = 300_000; // elapsedConfig().tickets.incremental.lookbackSeconds
const PAGE_SIZE = 50; // elapsedConfig().tickets.pagination.pageSize

type Route = Record<string, (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>;
let r: Record<string, Route>;

async function call(route: string, method: string, p: string, body?: unknown, ctx: Record<string, string> = {}) {
  const req = new Request(`http://127.0.0.1:4100${p}`, {
    method,
    headers: { ...AUTH, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await r[route][method](req, { params: Promise.resolve(ctx) });

  return { status: res.status, body: (await res.json()) as any };
}

/** One listing pass exactly as the Elapsed config describes it: page/limit, optional updated_since. */
async function listPass(updatedSince: string | null) {
  const ids: string[] = [];

  for (let page = 1; ; ) {
    const q = `page=${page}&limit=${PAGE_SIZE}${updatedSince ? `&updated_since=${encodeURIComponent(updatedSince)}` : ""}`;
    const { body } = await call("tickets", "GET", `/api/tickets?${q}`);

    ids.push(...body.data.items.map((t: { id: string }) => t.id));
    if (!body.data.pagination.next_page) return ids;
    page = body.data.pagination.next_page;
  }
}

/** Elapsed's cursor: the watermark advances only when a pass completes. */
function elapsedSync() {
  let watermark: string | null = null;
  const imported = new Set<string>();

  return {
    imported,
    async pass() {
      const anchor = Date.now();
      const ids = await listPass(watermark ?? new Date(anchor - 90 * 86_400_000).toISOString());

      ids.forEach((id) => imported.add(id));
      watermark = new Date(Math.max(watermark ? Date.parse(watermark) : 0, anchor - LOOKBACK_MS)).toISOString();
      return ids;
    },
  };
}

async function generate(count: number) {
  const key = `ing-key-${Math.random().toString(36).slice(2)}`;
  const { body } = await call("jobs", "POST", "/api/generator/jobs", { count, idempotency_key: key });
  let job = body.data;

  while (job.status === "running") job = (await call("advance", "POST", "/x", undefined, { id: job.id })).body.data;
  return job;
}

const normal = (title: string) => ({
  title,
  description: "hello",
  status: "open",
  priority: "high",
  requester: { id: "u1", name: "Mona", email: "mona@example.com" },
  customer: { id: "c1", name: "Acme" },
});

beforeAll(async () => {
  vi.stubEnv("DB_FILE", DB_FILE);
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("API_TOKEN", "test_token");
  vi.stubEnv("GENERATOR_MAX_TICKETS", "300");
  vi.stubEnv("GENERATOR_BATCH_SIZE", "40");
  r = {
    tickets: await import("@/app/api/tickets/route"),
    ticket: await import("@/app/api/tickets/[id]/route"),
    comments: await import("@/app/api/tickets/[id]/comments/route"),
    history: await import("@/app/api/tickets/[id]/history/route"),
    jobs: await import("@/app/api/generator/jobs/route"),
    advance: await import("@/app/api/generator/jobs/[id]/advance/route"),
    touch: await import("@/app/api/generator/synthetic/touch/route"),
  } as unknown as Record<string, Route>;
});

beforeEach(() => fs.rmSync(DB_FILE, { force: true }));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("incremental discovery (Elapsed's updated_since watermark)", () => {
  it("1. a normally created ticket is discovered by the next pass", async () => {
    const sync = elapsedSync();

    await sync.pass();
    const created = (await call("tickets", "POST", "/api/tickets", normal("Normal"))).body.data;

    expect(await sync.pass()).toEqual([created.id]);
  });

  it("2. generated tickets are discovered by the next pass, like normal ones", async () => {
    const sync = elapsedSync();

    await sync.pass(); // the integration is already active and has completed a pass
    const job = await generate(120);
    const found = await sync.pass();

    expect(job.processed).toBe(120);
    expect(found).toHaveLength(120);
    expect(found.every((id) => id.startsWith("SYN-"))).toBe(true);
  });

  it("generated tickets keep realistic history but are marked as changed when written", async () => {
    const before = Date.now();

    await generate(60);

    const { body } = await call("tickets", "GET", "/api/tickets?limit=100");

    for (const t of body.data.items) {
      expect(Date.parse(t.updated_at)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(t.created_at)).toBeLessThan(before - 9 * 86_400_000); // history stays back-dated
    }
  });

  it("5. pagination neither hides nor repeats generated tickets", async () => {
    await call("tickets", "POST", "/api/tickets", normal("Normal"));
    await generate(130);

    const all = await listPass(null);
    const since = await listPass(new Date(Date.now() - LOOKBACK_MS).toISOString());

    expect(all).toHaveLength(131);
    expect(new Set(all).size).toBe(131);
    expect(new Set(since)).toEqual(new Set(all));
  });

  it("6. repeated generation requests do not duplicate tickets", async () => {
    const sync = elapsedSync();
    const key = "repeat-key-12345";

    await call("jobs", "POST", "/api/generator/jobs", { count: 80, idempotency_key: key });
    await call("jobs", "POST", "/api/generator/jobs", { count: 80, idempotency_key: key });
    await Promise.all([1, 2, 3, 4].map(() => call("advance", "POST", "/x", undefined, { id: "gen-1" })));
    await sync.pass();

    expect(sync.imported.size).toBe(80);
  });

  it("re-stamps older synthetic tickets so Elapsed can pick them up, leaving real ones alone", async () => {
    await call("tickets", "POST", "/api/tickets", normal("Real"));
    await generate(60);

    // Simulate tickets generated before the fix: stale updated_at.
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

    for (const t of db.tickets) if (t.id.startsWith("SYN-")) t.updated_at = "2026-01-01T00:00:00.000Z";
    const real = db.tickets.find((t: { id: string }) => t.id.startsWith("TCK-"));

    fs.writeFileSync(DB_FILE, JSON.stringify(db));

    const sync = elapsedSync();

    await sync.pass();
    await sync.pass();
    expect([...sync.imported].filter((id) => id.startsWith("SYN-"))).toHaveLength(0);

    const res = await call("touch", "POST", "/api/generator/synthetic/touch");

    expect(res.body.data).toEqual({ touched: 60 });
    expect((await sync.pass()).filter((id) => id.startsWith("SYN-"))).toHaveLength(60);

    const after = JSON.parse(fs.readFileSync(DB_FILE, "utf8")).tickets.find((t: { id: string }) => t.id === real.id);

    expect(after.updated_at).toBe(real.updated_at);
  });
});

// The real Elapsed code (fetching, mapping, derivation) when the sibling checkout exists.
const ELAPSED = path.resolve(__dirname, "../../elapsed/packages/custom-ticket/src/index.ts");

describe.skipIf(!fs.existsSync(ELAPSED))("Elapsed ingestion pipeline (real @sla/custom-ticket)", () => {
  let server: http.Server;
  let origin = "";

  beforeAll(async () => {
    vi.stubEnv("CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS", "1");
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, "http://x");
      const m = url.pathname.match(/^\/api\/tickets(?:\/([^/]+)(?:\/(comments|history))?)?$/);
      const route = !m ? null : !m[1] ? "tickets" : (m[2] ?? "ticket");
      const out = !route
        ? new Response("{}", { status: 404 })
        : await r[route].GET(new Request(`http://127.0.0.1${req.url}`, { headers: { authorization: req.headers.authorization ?? "" } }), { params: Promise.resolve({ id: m![1] ?? "" }) });

      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(await out.text());
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server?.close());

  it("3 + 4. imports normal and generated tickets, and they become cases after derivation", async () => {
    const el: any = await import(/* @vite-ignore */ ELAPSED);
    const { elapsedConfig } = await import("@/lib/server/elapsed-config");
    const parsed = el.parseConfig(elapsedConfig(origin));

    expect(parsed.ok).toBe(true);

    const session = el.openOutboundSession(parsed.config, { token: "test_token" });
    const endpoint = { request: parsed.config.tickets.request, itemsPath: parsed.config.tickets.itemsPath, pagination: parsed.config.tickets.pagination };

    try {
      // Pass 1 against an empty provider completes; then tickets arrive, as in real use.
      const first = await el.fetchPage(session.client, endpoint, el.START, { updatedSince: new Date(Date.now() - 90 * 86_400_000).toISOString() });
      const watermark = new Date(Date.now() - LOOKBACK_MS).toISOString();

      expect(first.items).toHaveLength(0);

      await call("tickets", "POST", "/api/tickets", normal("Normal"));
      await generate(55);

      const items: any[] = [];

      for (let pos = el.START; ; ) {
        const page = await el.fetchPage(session.client, endpoint, pos, { updatedSince: watermark });

        items.push(...page.items);
        if (!page.next) break;
        pos = page.next;
      }

      expect(items).toHaveLength(56); // 2 pages of 50
      expect(items.filter((t) => t.id.startsWith("SYN-"))).toHaveLength(55);

      const rows: any[] = [];

      for (const item of items) {
        const built = await el.buildTicketEvents(session.client, parsed.config, item);

        for (const e of built.events) rows.push({ id: `r${rows.length}`, providerEventId: e.providerEventId, payload: e.payload, fetchedAt: new Date(0) });
      }

      const derived = el.deriveBatch(parsed.config, rows);

      expect(derived.failures).toEqual([]);
      expect(derived.diagnostics).toEqual([]);
      expect(derived.cases).toHaveLength(56);
      expect(derived.cases.filter((c: any) => c.externalId.startsWith("SYN-"))).toHaveLength(55);
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
