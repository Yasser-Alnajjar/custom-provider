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

    const { withDb } = await import("@/lib/server/db");
    const { createTicket } = await import("@/lib/server/tickets");
    const ticket = await withDb(true, (s) => createTicket(s, { title: "A", status: "new", priority: "low", requester: { email: "a@b.c" } }));

    expect(ticket.id).toBe("TCK-1050");
    fs.rmSync(dir, { recursive: true });
  });
});
