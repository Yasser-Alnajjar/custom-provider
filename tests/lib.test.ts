import { describe, expect, it } from "vitest";
import { buildDirectory, requesterKey } from "@/lib/directory";
import { filterEvents, filterTickets, sortTickets } from "@/lib/filters";
import { formatDuration, humanize, initials, relativeTime, resolutionMs } from "@/lib/format";
import { buildCreateBody, buildPatch, parseTags } from "@/lib/ticket-payload";
import { firstResponseMs, timeInStatus } from "@/lib/ticket-metrics";
import type { Ticket, TicketEvent } from "@/lib/types";

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: "TCK-1001",
  title: "Login broken",
  description: "cannot sign in",
  status: "open",
  priority: "high",
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-01T12:00:00.000Z",
  resolved_at: null,
  requester: { id: "u1", name: "Mona", email: "Mona@Example.com" },
  customer: { id: "c1", name: "Acme" },
  assignee: { id: "a1", name: "Omar" },
  tags: ["auth"],
  channel: "email",
  url: null,
  ...over,
});

const event = (over: Partial<TicketEvent>): TicketEvent => ({
  id: "evt-1", ticket_id: "TCK-1001", type: "comment", created_at: "2026-10-01T11:00:00.000Z", public: true, body: "hi", author: { id: "a1", name: "Omar", role: "agent" }, ...over,
});

describe("format", () => {
  it("formats text and durations", () => {
    expect(initials("Mona Hassan")).toBe("MH");
    expect(initials("")).toBe("?");
    expect(humanize("in_progress")).toBe("In progress");
    expect(formatDuration(20_000)).toBe("under a minute");
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
    expect(formatDuration(26 * 3600_000)).toBe("1d 2h");
  });

  it("shows clock-skewed timestamps as absolute and recent ones as 'just now'", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");

    expect(relativeTime("2026-10-01T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-01T13:00:00Z", now)).not.toMatch(/in/);
    expect(relativeTime(null)).toBe("—");
  });

  it("only trusts resolved_at for resolved tickets with sane dates", () => {
    expect(resolutionMs(ticket({ status: "open", resolved_at: "2026-10-02T10:00:00Z" }))).toBeNull();
    expect(resolutionMs(ticket({ status: "solved", resolved_at: "2026-10-01T11:00:00Z" }))).toBe(3600_000);
    expect(resolutionMs(ticket({ status: "solved", resolved_at: "2026-09-01T11:00:00Z" }))).toBeNull();
  });
});

describe("directory", () => {
  it("derives customers, requesters and agents from tickets and events", () => {
    const tickets = [ticket(), ticket({ id: "TCK-1002", assignee: null })];
    const events = [event({}), event({ id: "evt-2", author: { id: "u1", name: "Mona", role: "customer" } }), event({ id: "evt-3", author: { id: "system", name: "System", role: "system" } })];
    const dir = buildDirectory(tickets, events);

    expect(dir.customers.get("c1")?.tickets).toHaveLength(2);
    expect(dir.requesters.get(requesterKey({ email: "mona@example.com" }))?.events).toHaveLength(1);
    expect([...dir.agents.keys()]).toEqual(["a1"]);
    expect(dir.agents.get("a1")?.events).toHaveLength(1);
  });

  it("adds registered people without tickets and never duplicates derived ones", () => {
    const dir = buildDirectory([ticket()], [], {
      customers: [{ id: "c1", name: "Dup" }, { id: "c2", name: "Empty Co" }],
      requesters: [{ name: "New", email: "New@x.io" }],
      agents: [{ id: "a2", name: "Fresh" }],
    });

    expect([...dir.customers.keys()]).toEqual(["c1", "c2"]);
    expect(dir.customers.get("c1")?.name).not.toBe("Dup");
    expect(dir.customers.get("c2")?.tickets).toHaveLength(0);
    expect(dir.requesters.has("new@x.io")).toBe(true);
    expect(dir.agents.get("a2")?.name).toBe("Fresh");
  });
});

describe("filters", () => {
  const tickets = [ticket(), ticket({ id: "TCK-1002", status: "solved", assignee: null, priority: "low", tags: [] })];
  const none = { q: "", status: "", priority: "", assignee: "", customer: "", channel: "", tag: "" };

  it("filters by status list, assignee, tag and free text", () => {
    expect(filterTickets(tickets, { ...none, status: "open,in_progress" })).toHaveLength(1);
    expect(filterTickets(tickets, { ...none, assignee: "none" }).map((t) => t.id)).toEqual(["TCK-1002"]);
    expect(filterTickets(tickets, { ...none, tag: "auth" })).toHaveLength(1);
    expect(filterTickets(tickets, { ...none, q: "mona@example" })).toHaveLength(2);
  });

  it("sorts by priority and falls back to id", () => {
    expect(sortTickets(tickets, "priority:desc").map((t) => t.id)).toEqual(["TCK-1001", "TCK-1002"]);
    expect(sortTickets(tickets, "id:desc").map((t) => t.id)).toEqual(["TCK-1002", "TCK-1001"]);
  });

  it("filters events by visibility and role", () => {
    const events = [event({}), event({ id: "evt-2", public: false })];

    expect(filterEvents(events, { q: "", type: "", visibility: "internal", role: "" }, () => undefined)).toHaveLength(1);
    expect(filterEvents(events, { q: "", type: "", visibility: "", role: "customer" }, () => undefined)).toHaveLength(0);
  });
});

describe("ticket metrics", () => {
  it("measures the first public agent reply", () => {
    const t = ticket();

    expect(firstResponseMs(t, [event({ public: false }), event({ id: "evt-2", created_at: "2026-10-01T10:30:00.000Z" })])).toBe(30 * 60_000);
    expect(firstResponseMs(t, [])).toBeNull();
  });

  it("splits time per status from real transitions", () => {
    const spans = timeInStatus(ticket(), [event({ type: "status_changed", from: "new", to: "open", created_at: "2026-10-01T10:10:00.000Z" })], Date.parse("2026-10-01T11:00:00Z"));

    expect(spans).toEqual([{ status: "new", ms: 600_000 }, { status: "open", ms: 3000_000, current: true }]);
  });
});

describe("ticket payloads", () => {
  const dir = buildDirectory([ticket()], []);
  const base = { title: " T ", description: " d ", status: "open", priority: "normal", channel: "web", tags: "A, b, a", email: "mona@example.com", requesterName: "Other", customerKey: "", assigneeId: "a1" };

  it("normalises tags", () => expect(parseTags("A, b, a, ,")).toEqual(["a", "b"]));

  it("reuses a returning requester's stored identity and customer", () => {
    const body = buildCreateBody(base, dir);

    expect(body).toMatchObject({ title: "T", tags: ["a", "b"], requester: { id: "u1", name: "Mona" }, customer: { id: "c1", name: "Acme" }, assignee: { id: "a1", name: "Omar" } });
  });

  it("sends a new requester as typed", () => {
    expect(buildCreateBody({ ...base, email: "new@x.com", assigneeId: "" }, dir)).toMatchObject({ requester: { name: "Other", email: "new@x.com" } });
  });

  it("patches only changed fields", () => {
    const t = ticket();
    const same = { title: t.title, description: t.description ?? "", channel: t.channel ?? "", tags: "auth", requesterName: "Mona", email: "Mona@Example.com", customerKey: "c1" };

    expect(buildPatch(t, same, dir)).toEqual({});
    expect(buildPatch(t, { ...same, title: "New", tags: "auth, ui" }, dir)).toEqual({ title: "New", tags: ["auth", "ui"] });
  });
});
