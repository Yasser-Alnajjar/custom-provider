/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTING_DEFS, validateOverrides } from "@/lib/settings";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acmedesk-settings-"));
const DB_FILE = path.join(dir, "db.json");
const AUTH = { Authorization: "Bearer test_token" };

type Route = Record<string, (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>;
let r: Record<string, Route>;

async function call(route: string, method: string, p: string, body?: unknown, headers: Record<string, string> = AUTH) {
  const req = new Request(`http://127.0.0.1:4100${p}`, {
    method,
    headers: { ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await r[route][method](req, { params: Promise.resolve({}) });

  return { status: res.status, body: (await res.json()) as any };
}

const put = (settings: unknown) => call("settings", "PUT", "/api/settings", settings);
const list = (q: string) => call("tickets", "GET", `/api/tickets${q}`);

/** Seeds `n` tickets straight into the database file. */
function seed(n: number) {
  const now = new Date().toISOString();
  const tickets = Array.from({ length: n }, (_, i) => ({
    id: `TCK-${String(1000 + i).padStart(5, "0")}`, title: `T${i}`, description: "d", status: "open", priority: "low",
    created_at: now, updated_at: now, resolved_at: null, tags: [], channel: "email", assignee: null,
    requester: { id: "u", name: "U", email: "u@x.io" }, customer: { id: "c", name: "C" },
  }));

  fs.writeFileSync(DB_FILE, JSON.stringify({ evtSeq: 0, nextNum: 1000 + n, tickets, events: [] }));
}

beforeAll(async () => {
  vi.stubEnv("DB_FILE", DB_FILE);
  vi.stubEnv("API_TOKEN", "test_token");
  r = {
    tickets: (await import("@/app/api/tickets/route")) as any,
    settings: (await import("@/app/api/settings/route")) as any,
    jobs: (await import("@/app/api/generator/jobs/route")) as any,
  };
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  seed(650);
  vi.unstubAllEnvs();
  vi.stubEnv("DB_FILE", DB_FILE);
  vi.stubEnv("API_TOKEN", "test_token");
});

describe("max page size (the 100 -> 500 case)", () => {
  it("is capped at 100 by default, exactly as before", async () => {
    const { body } = await list("?limit=500");

    expect(body.data.items).toHaveLength(100);
    expect(body.data.pagination).toMatchObject({ limit: 100, total: 650, total_pages: 7, next_page: 2 });
  });

  it("returns up to 500 records once maxLimit is saved as 500", async () => {
    const saved = await put({ api: { maxLimit: 500 } });

    expect(saved.status).toBe(200);
    expect(saved.body.data.effective.api.maxLimit).toBe(500);
    expect(saved.body.data.sources["api.maxLimit"]).toBe("saved");

    const { body } = await list("?limit=500");

    expect(body.data.items).toHaveLength(500);
    expect(body.data.pagination).toMatchObject({ page: 1, limit: 500, total: 650, total_pages: 2, next_page: 2 });
    // The next page holds the remaining 150: pagination still works.
    const page2 = (await list("?limit=500&page=2")).body.data;

    expect(page2.items).toHaveLength(150);
    expect(page2.pagination.next_page).toBeNull();
    expect(new Set([...body.data.items, ...page2.items].map((t: any) => t.id)).size).toBe(650);
  });

  it("is persisted in the database file, so it survives a restart", async () => {
    await put({ api: { maxLimit: 500 } });
    expect(JSON.parse(fs.readFileSync(DB_FILE, "utf8")).settings).toEqual({ api: { maxLimit: 500 } });
    expect((await list("?limit=400")).body.data.items).toHaveLength(400);
  });

  it("is still capped at the (new) maximum and can be lowered", async () => {
    await put({ api: { maxLimit: 500 } });
    expect((await list("?limit=900")).body.data.items).toHaveLength(500);
    await put({ api: { maxLimit: 30, defaultLimit: 10 } });
    expect((await list("?limit=500")).body.data.items).toHaveLength(30);
    expect((await list("")).body.data.items).toHaveLength(10);
  });

  it("does not touch the pre-existing pagination behaviour", async () => {
    const all: string[] = [];

    for (let page = 1; ; ) {
      const { body } = await list(`?page=${page}&limit=50`);

      all.push(...body.data.items.map((t: any) => t.id));
      if (!body.data.pagination.next_page) break;
      page = body.data.pagination.next_page;
    }
    expect(all).toHaveLength(650);
    expect((await list("")).body.data.pagination).toMatchObject({ limit: 20, page: 1 }); // default page size is still 20
    expect((await list("?limit=0")).body.data.pagination.limit).toBe(1);
    expect((await list("?page=0")).body.data.pagination.page).toBe(1);
  });

  it("is independent of the provider-side pageSize: 50 per page keeps working under any maxLimit", async () => {
    await put({ api: { maxLimit: 500 } });
    expect((await list("?limit=50")).body.data.items).toHaveLength(50);
  });
});

describe("default page size", () => {
  it("is used when ?limit is omitted and reported in the response", async () => {
    await put({ api: { defaultLimit: 35 } });
    const { body } = await list("");

    expect(body.data.items).toHaveLength(35);
    expect(body.data.pagination.limit).toBe(35);
  });
});

describe("request body limit", () => {
  it("rejects bodies over maxBodyBytes and accepts them again after raising it", async () => {
    const ticket = (title: string) => ({ title, description: "x".repeat(2000), status: "open", priority: "low", requester: { email: "a@b.co" } });

    expect((await call("tickets", "POST", "/api/tickets", ticket("ok"))).status).toBe(201);
    expect((await put({ api: { maxBodyBytes: 1024 } })).status).toBe(200);
    const rejected = await call("tickets", "POST", "/api/tickets", ticket("big"));

    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toBe("Body too large");
    await put({ api: { maxBodyBytes: 10_000 } });
    expect((await call("tickets", "POST", "/api/tickets", ticket("ok again"))).status).toBe(201);
  });
});

describe("generator limits", () => {
  const job = (count: number) => call("jobs", "POST", "/api/generator/jobs", { count, idempotency_key: `key-${Math.random().toString(36).slice(2)}` });

  it("come from the environment until saved settings override them", async () => {
    vi.stubEnv("GENERATOR_MAX_TICKETS", "7");
    expect((await call("settings", "GET", "/api/settings")).body.data.sources["generator.maxTickets"]).toBe("environment");
    expect((await job(8)).status).toBe(400);
    await put({ generator: { maxTickets: 20 } });
    expect((await call("settings", "GET", "/api/settings")).body.data.sources["generator.maxTickets"]).toBe("saved");
    expect((await job(8)).status).toBe(201);
  });

  it("can be disabled from settings", async () => {
    await put({ generator: { enabled: false } });
    const res = await job(5);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("disabled");
  });
});

describe("settings API", () => {
  it("requires authentication", async () => {
    expect((await call("settings", "GET", "/api/settings", undefined, {})).status).toBe(401);
    expect((await call("settings", "PUT", "/api/settings", {}, {})).status).toBe(401);
  });

  it("returns overrides, effective values, defaults and sources", async () => {
    const { body } = await call("settings", "GET", "/api/settings");

    expect(body.data.defaults.api).toEqual({ defaultLimit: 20, maxLimit: 100, maxBodyBytes: 1_000_000 });
    expect(body.data.overrides).toEqual({});
    expect(Object.values(body.data.sources)).toEqual(Array(SETTING_DEFS.length).fill("default"));
  });

  it("null / omission / {} go back to the defaults and remove the stored override", async () => {
    await put({ api: { maxLimit: 500 } });
    await put({ api: { maxLimit: null } });
    expect((await list("?limit=500")).body.data.items).toHaveLength(100);
    await put({ api: { maxLimit: 500 } });
    await put({});
    expect("settings" in JSON.parse(fs.readFileSync(DB_FILE, "utf8"))).toBe(false);
    expect((await list("?limit=500")).body.data.items).toHaveLength(100);
  });

  it("rejects invalid documents without saving anything", async () => {
    await put({ api: { maxLimit: 500 } });
    for (const bad of [
      { api: { maxLimit: 0 } }, { api: { maxLimit: 5001 } }, { api: { maxLimit: 1.5 } }, { api: { maxLimit: "500" } },
      { api: { defaultLimit: 600 } }, { api: { rateLimit: 10 } }, { server: {} }, { api: [] }, { generator: { enabled: "yes" } }, [],
    ]) {
      const res = await put(bad);

      expect(res.status, JSON.stringify(bad)).toBe(400);
      if (Array.isArray(bad)) continue; // a non-object body is rejected earlier, by the shared body parser
      expect(res.body.error).toBe("validation_error");
      expect(res.body.details).toBeTruthy();
    }
    expect((await list("?limit=500")).body.data.items).toHaveLength(500); // unchanged
  });

  it("only lists settings that exist in the server (no rate limits or timeouts)", () => {
    expect(SETTING_DEFS.map((d) => `${d.group}.${d.key}`)).toEqual([
      "api.defaultLimit", "api.maxLimit", "api.maxBodyBytes", "generator.enabled", "generator.maxTickets", "generator.batchSize", "generator.maxTotal",
    ]);
  });

  it("validateOverrides checks the default <= max rule against the fallback values too", () => {
    const defaults = { api: { defaultLimit: 20, maxLimit: 100, maxBodyBytes: 1e6 }, generator: { enabled: true, maxTickets: 1, batchSize: 1, maxTotal: 1 } };

    expect(validateOverrides({ api: { maxLimit: 10 } }, defaults).ok).toBe(false); // inherited default 20 > 10
    expect(validateOverrides({ api: { maxLimit: 10, defaultLimit: 10 } }, defaults).ok).toBe(true);
  });

  it("does not change the provider JSON document", async () => {
    const cfg = (await import("@/lib/server/elapsed-config")).elapsedConfig("http://x");

    await put({ api: { maxLimit: 500 } });
    expect(JSON.stringify((await import("@/lib/server/elapsed-config")).elapsedConfig("http://x"))).toBe(JSON.stringify(cfg));
    expect(cfg.tickets.pagination.pageSize).toBe(50);
  });
});
