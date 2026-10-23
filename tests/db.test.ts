import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("file database", () => {
  it("creates the file on first write and keeps the stored shape", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acmedesk-db-"));
    const file = path.join(dir, "nested", "db.json");

    vi.stubEnv("DB_FILE", file);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");

    const { withDb } = await import("@/lib/server/db");
    const { createTicket } = await import("@/lib/server/tickets");

    expect((await withDb(false, (s) => s.tickets)).length).toBe(0);
    expect(fs.existsSync(file)).toBe(false);

    await withDb(true, (s) => createTicket(s, { title: "A", status: "open", priority: "low", requester: { email: "a@b.c" } }));

    const stored = JSON.parse(fs.readFileSync(file, "utf8"));

    expect(Object.keys(stored).sort()).toEqual(["events", "evtSeq", "nextNum", "tickets"]);
    expect(stored.nextNum).toBe(1002);
    expect(stored.evtSeq).toBe(2); // created + status change (no description)
    fs.rmSync(dir, { recursive: true });
  });

  it("reads an existing database written by the previous server", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acmedesk-db-"));
    const file = path.join(dir, "db.json");

    fs.writeFileSync(file, JSON.stringify({ evtSeq: 7, nextNum: 1050, tickets: [], events: [] }));
    vi.stubEnv("DB_FILE", file);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");

    const { withDb } = await import("@/lib/server/db");
    const { createTicket } = await import("@/lib/server/tickets");
    const ticket = await withDb(true, (s) => createTicket(s, { title: "A", status: "new", priority: "low", requester: { email: "a@b.c" } }));

    expect(ticket.id).toBe("TCK-1050");
    fs.rmSync(dir, { recursive: true });
  });
});

describe("redis database", () => {
  function fakeRedis() {
    const kv = new Map<string, string>();
    const calls: unknown[][] = [];
    let conflictOnce = false;

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const cmd = JSON.parse(init.body as string) as string[];

      calls.push(cmd);

      if (cmd[0] === "MGET") return Response.json({ result: [kv.get(cmd[1]) ?? null, kv.get(cmd[2]) ?? null] });

      // EVAL <script> 2 dataKey revKey loadedRev payload: compare-and-set on the revision.
      const [, , , dataKey, revKey, loadedRev, payload] = cmd;

      if (conflictOnce) {
        conflictOnce = false;
        kv.set(revKey, "99");
      }

      if ((kv.get(revKey) ?? "0") !== loadedRev) return Response.json({ result: 0 });

      kv.set(dataKey, payload);
      kv.set(revKey, String(Number(loadedRev) + 1));
      return Response.json({ result: Number(loadedRev) + 1 });
    });

    return { kv, calls, fetchMock, conflictNextSave: () => (conflictOnce = true) };
  }

  it("saves with a revision check and retries on conflict", async () => {
    const redis = fakeRedis();

    vi.stubGlobal("fetch", redis.fetchMock);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    vi.stubEnv("REDIS_KEY", "t:db");

    const { withDb } = await import("@/lib/server/db");
    let runs = 0;

    redis.conflictNextSave();
    await withDb(true, (s) => {
      runs++;
      s.nextNum += 1;
    });

    expect(runs).toBe(2); // first save lost the race, the retry succeeded on newer data
    expect(redis.kv.get("t:db:rev")).toBe("100");
    expect(JSON.parse(redis.kv.get("t:db")!).nextNum).toBe(1002);
    expect(redis.fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("reports storage failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "WRONGPASS" }, { status: 401 })));
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test");

    const { withDb } = await import("@/lib/server/db");
    const { StorageError } = await import("@/lib/server/errors");

    await expect(withDb(false, (s) => s)).rejects.toBeInstanceOf(StorageError);
  });
});
