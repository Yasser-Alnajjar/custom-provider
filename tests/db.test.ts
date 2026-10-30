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
    vi.stubEnv("SUPABASE_URL", "");

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
    vi.stubEnv("SUPABASE_URL", "");

    const { withDb } = await import("@/lib/server/db");
    const { createTicket } = await import("@/lib/server/tickets");
    const ticket = await withDb(true, (s) => createTicket(s, { title: "A", status: "new", priority: "low", requester: { email: "a@b.c" } }));

    expect(ticket.id).toBe("TCK-1050");
    fs.rmSync(dir, { recursive: true });
  });
});

describe("supabase database", () => {
  function fakeSupabase() {
    let row: { id: string; data: unknown; rev: number } | null = null;
    let conflictOnce = false;

    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method || "GET";
      const body = init.body ? JSON.parse(init.body as string) : null;

      if (method === "GET") return Response.json(row ? [{ data: row.data, rev: row.rev }] : []);

      if (method === "POST") {
        if (row) return Response.json([]); // ignore-duplicates: nothing inserted
        row = body;
        return Response.json([body]);
      }

      // PATCH ?id=eq.main&rev=eq.<loaded>: compare-and-set on the revision.
      const loaded = Number(new URL(url).searchParams.get("rev")?.replace("eq.", ""));

      if (conflictOnce) {
        conflictOnce = false;
        row!.rev += 10;
      }

      if (!row || row.rev !== loaded) return Response.json([]);
      row = { ...row, ...body };
      return Response.json([row]);
    });

    return { fetchMock, row: () => row, conflictNextSave: () => (conflictOnce = true) };
  }

  it("creates the row, saves with a revision check and retries on conflict", async () => {
    const sb = fakeSupabase();

    vi.stubGlobal("fetch", sb.fetchMock);
    vi.stubEnv("SUPABASE_URL", "https://x.supabase.test/");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key");
    vi.stubEnv("SUPABASE_TABLE", "t_db");

    const { withDb } = await import("@/lib/server/db");
    let runs = 0;

    await withDb(true, (s) => {
      s.nextNum += 1; // first save creates the row
    });
    expect(sb.row()).toMatchObject({ rev: 1, data: { nextNum: 1002 } });

    sb.conflictNextSave();
    await withDb(true, (s) => {
      runs++;
      s.nextNum += 1;
    });

    expect(runs).toBe(2); // first save lost the race, the retry succeeded on newer data
    expect(sb.row()).toMatchObject({ rev: 12, data: { nextNum: 1003 } });
    expect(sb.fetchMock.mock.calls[0][0]).toBe("https://x.supabase.test/rest/v1/t_db?id=eq.main&select=data,rev");
    expect(sb.fetchMock.mock.calls[0][1].headers).toMatchObject({ apikey: "key", Authorization: "Bearer key" });
  });

  it("reports storage failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Invalid API key" }, { status: 401 })));
    vi.stubEnv("SUPABASE_URL", "https://x.supabase.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "bad");

    const { withDb } = await import("@/lib/server/db");
    const { StorageError } = await import("@/lib/server/errors");

    await expect(withDb(false, (s) => s)).rejects.toBeInstanceOf(StorageError);
  });
});
