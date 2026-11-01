import { describe, expect, it } from "vitest";
import { elapsedConfig } from "@/lib/server/elapsed-config";
import { PAGINATION_TYPES } from "@/lib/config-builder/contract";
import {
  configToState, defaultState, importConfig, kvAdd, kvRemove, kvUpdate, serialize, setExtras, setField, toConfig,
  type BuilderState,
} from "@/lib/config-builder/model";
import { checkConfig, errorsOf, validate } from "@/lib/config-builder/validate";
import { estimateRequests } from "@/lib/config-builder/volume";

const ORIGIN = "http://127.0.0.1:4100";
const acme = () => elapsedConfig(ORIGIN);
const fromAcme = (): BuilderState => {
  const r = configToState(acme());

  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const out = (s: BuilderState) => toConfig(s) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const errorPaths = (s: BuilderState) => errorsOf(validate(s)).map((i) => i.path);

describe("import / export", () => {
  it("round-trips the Acme Desk configuration byte for byte (including key order)", () => {
    expect(serialize(fromAcme())).toBe(JSON.stringify(acme(), null, 2));
  });

  it("the Acme configuration and the default template are valid", () => {
    expect(errorsOf(validate(fromAcme()))).toEqual([]);
    expect(validate(fromAcme())).toEqual([]);
    expect(errorsOf(validate(defaultState()))).toEqual([]);
  });

  it("is not hard-wired to Acme: the default template exports a different, valid document", () => {
    const d = out(defaultState("https://helpdesk.test"));

    expect(d.displayName).not.toBe(acme().displayName);
    expect(d.connection.baseUrl).toBe("https://helpdesk.test");
    expect(d.comments).toBeUndefined();
    expect(d.statusHistory).toBeUndefined();
  });

  it("imports JSON text and reports invalid JSON / non-objects", () => {
    const ok = importConfig(JSON.stringify(acme()));

    expect(ok.ok).toBe(true);
    expect(importConfig("{nope").ok).toBe(false);
    expect(importConfig("[]")).toEqual({ ok: false, error: "The configuration must be a JSON object." });
    expect(importConfig("null").ok).toBe(false);
  });

  it("preserves unknown fields at every level instead of discarding them", () => {
    const cfg = acme() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    cfg.futureRoot = { a: 1 };
    cfg.auth.header = "X-Token";
    cfg.tickets.request.timeoutMs = 5000;
    cfg.tickets.request.query.extra = "1";
    cfg.tickets.pagination.maxPages = 10;
    cfg.mapping.assignee = "$.assignee";
    cfg.valueMaps.type = { bug: "incident" };
    cfg.valueMaps.status.weird = "x";
    cfg.creationActor.id = "bot";

    const r = configToState(cfg);

    expect(r.ok && r.notes.join("\n")).toContain("futureRoot");
    expect(JSON.parse(serialize((r as { state: BuilderState }).state))).toEqual(cfg);
  });

  it("keeps wrongly typed values unchanged and reports them", () => {
    const cfg = acme() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    cfg.displayName = 42;
    cfg.tickets.request.query.n = 7;
    cfg.mapping.id = { nested: true };

    const r = configToState(cfg);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.some((n) => n.startsWith("displayName"))).toBe(true);
    // Nothing lost: the document comes back with the same values and types.
    expect(JSON.parse(serialize(r.state)).tickets.request.query.n).toBe(7);
    expect(JSON.parse(serialize(r.state)).mapping.id).toEqual({ nested: true });
    expect(JSON.parse(serialize(r.state)).displayName).toBe(42);
  });

  it("keeps numeric strings as strings, including after editing them", () => {
    const cfg = acme() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    cfg.importWindowDays = "90";
    cfg.tickets.pagination.pageSize = "50";
    const r = configToState(cfg);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(serialize(r.state))).toEqual(cfg);
    const edited = setField(setField(r.state, "importWindowDays", "30"), "tickets.pagination.values.pageSize", "25");

    expect(out(edited).importWindowDays).toBe("30");
    expect(out(edited).tickets.pagination.pageSize).toBe("25");
  });

  it("treats absent comments/statusHistory/incremental as disabled and keeps them out of the output", () => {
    const cfg = acme() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    delete cfg.comments;
    delete cfg.statusHistory;
    delete cfg.tickets.incremental;
    const r = configToState(cfg);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.comments.enabled).toBe(false);
    expect(r.state.statusHistory.enabled).toBe(false);
    expect(JSON.parse(serialize(r.state))).toEqual(cfg);
  });
});

describe("General section", () => {
  it("schemaVersion, displayName, baseUrl and auth type reach the JSON with correct types", () => {
    let s = fromAcme();

    s = setField(s, "schemaVersion", "2");
    s = setField(s, "displayName", "Other");
    s = setField(s, "baseUrl", "https://x.test");
    s = setField(s, "authType", "bearer");
    const o = out(s);

    expect(o.schemaVersion).toBe(2);
    expect(typeof o.schemaVersion).toBe("number");
    expect(o.displayName).toBe("Other");
    expect(o.connection).toEqual({ baseUrl: "https://x.test" });
    expect(o.auth).toEqual({ type: "bearer" });
  });

  it("flags empty and malformed general fields next to the field", () => {
    let s = fromAcme();

    s = setField(s, "schemaVersion", "one");
    s = setField(s, "displayName", "");
    s = setField(s, "baseUrl", "not a url");
    s = setField(s, "authType", "");
    expect(errorPaths(s)).toEqual(expect.arrayContaining(["schemaVersion", "displayName", "baseUrl", "authType"]));
    expect(setField(s, "baseUrl", "ftp://x.test")).toBeTruthy();
    expect(errorPaths(setField(fromAcme(), "baseUrl", "ftp://x.test"))).toContain("baseUrl");
    expect(out(s).schemaVersion).toBe("one"); // invalid input stays visible rather than being coerced
  });

  it("warns (without blocking) on values the reference configuration does not use", () => {
    const s = setField(fromAcme(), "authType", "oauth2");
    const issue = validate(s).find((i) => i.path === "authType");

    expect(issue?.severity).toBe("warning");
    expect(out(s).auth.type).toBe("oauth2");
  });
});

describe("Tickets section", () => {
  it("request method, path and itemsPath", () => {
    let s = fromAcme();

    s = setField(s, "tickets.request.method", "POST");
    s = setField(s, "tickets.request.path", "/v2/tickets");
    s = setField(s, "tickets.itemsPath", "$.results[*]");
    expect(out(s).tickets.request).toMatchObject({ method: "POST", path: "/v2/tickets" });
    expect(out(s).tickets.itemsPath).toBe("$.results[*]");
  });

  it("validates path and itemsPath", () => {
    let s = setField(fromAcme(), "tickets.request.path", "tickets");

    s = setField(s, "tickets.itemsPath", "items");
    expect(errorPaths(s)).toEqual(expect.arrayContaining(["tickets.request.path", "tickets.itemsPath"]));
    expect(errorPaths(setField(s, "tickets.request.path", ""))).toContain("tickets.request.path");
  });

  it("incremental format and lookback, and the toggle", () => {
    let s = setField(fromAcme(), "incremental.lookbackSeconds", "60");

    s = setField(s, "incremental.format", "epoch");
    expect(out(s).tickets.incremental).toEqual({ format: "epoch", lookbackSeconds: 60 });
    expect(errorPaths(setField(s, "incremental.lookbackSeconds", "-5"))).toContain("incremental.lookbackSeconds");
    expect(out(setField(s, "incremental.enabled", false)).tickets.incremental).toBeUndefined();
  });

  it("warns when {{updatedSince}} and incremental are out of step", () => {
    const off = setField(fromAcme(), "incremental.enabled", false);

    expect(validate(off).some((i) => i.path === "incremental.enabled")).toBe(true);
    const noParam = kvRemove(setField(fromAcme(), "incremental.enabled", true), "tickets.request.query", fromAcme().tickets.request.query[0].id);

    expect(validate(noParam).some((i) => i.path === "incremental.enabled")).toBe(false);
  });
});

describe("Query parameters", () => {
  it("add, edit and remove entries and reflect them in the JSON", () => {
    let s = fromAcme();

    s = kvAdd(s, "tickets.request.query", "status", "open");
    expect(out(s).tickets.request.query).toEqual({ updated_since: "{{updatedSince}}", status: "open" });
    const id = s.tickets.request.query[1].id;

    s = kvUpdate(s, "tickets.request.query", id, { key: "state", value: "closed" });
    expect(out(s).tickets.request.query).toEqual({ updated_since: "{{updatedSince}}", state: "closed" });
    s = kvRemove(s, "tickets.request.query", id);
    s = kvRemove(s, "tickets.request.query", s.tickets.request.query[0].id);
    expect(out(s).tickets.request.query).toEqual({}); // the key existed in the document, so it stays
    const d = kvRemove(kvAdd(defaultState(), "tickets.request.query", "a", "b"), "tickets.request.query", "x");

    expect(out(d).tickets.request.query).toBeDefined();
    expect(out(kvRemove(d, "tickets.request.query", d.tickets.request.query[0].id)).tickets.request.query).toBeUndefined(); // never in the document: omitted
  });

  it("works for comments and status history as well", () => {
    const s = kvAdd(fromAcme(), "comments.request.query", "include", "internal");
    const h = kvAdd(fromAcme(), "statusHistory.request.query", "order", "asc");

    expect(out(s).comments.request.query).toEqual({ include: "internal" });
    expect(out(h).statusHistory.request.query).toEqual({ order: "asc" });
  });

  it("flags duplicate and nameless parameters", () => {
    let s = kvAdd(fromAcme(), "tickets.request.query", "updated_since", "x");

    expect(errorPaths(s)).toContain("tickets.request.query.1.key");
    s = kvAdd(fromAcme(), "tickets.request.query", "", "orphan value");
    expect(errorPaths(s)).toContain("tickets.request.query.1.key");
    expect(errorPaths(kvAdd(fromAcme(), "tickets.request.query"))).toEqual([]); // a blank row is simply ignored
  });
});

describe("Pagination", () => {
  it("lists exactly the types the reference contract verifies", () => {
    expect(PAGINATION_TYPES.map((t) => t.value)).toEqual(["none", "page"]);
  });

  it("changing every page option changes the JSON", () => {
    let s = fromAcme();

    s = setField(s, "tickets.pagination.values.param", "p");
    s = setField(s, "tickets.pagination.values.startAt", "0");
    s = setField(s, "tickets.pagination.values.sizeParam", "per_page");
    s = setField(s, "tickets.pagination.values.pageSize", "25");
    expect(out(s).tickets.pagination).toEqual({ type: "page", param: "p", startAt: 0, sizeParam: "per_page", pageSize: 25 });
  });

  it("switching to none drops the page options from the JSON, and back restores them", () => {
    let s = setField(fromAcme(), "tickets.pagination.type", "none");

    expect(out(s).tickets.pagination).toEqual({ type: "none" });
    s = setField(s, "tickets.pagination.type", "page");
    expect(out(s).tickets.pagination).toEqual(acme().tickets.pagination);
  });

  it("paginates comments and status history independently", () => {
    let s = setField(fromAcme(), "comments.pagination.type", "page");

    s = setField(s, "comments.pagination.values.param", "page");
    s = setField(s, "comments.pagination.values.pageSize", "20");
    s = setField(s, "comments.pagination.values.sizeParam", "limit");
    expect(out(s).comments.pagination).toEqual({ type: "page", param: "page", sizeParam: "limit", pageSize: 20 });
    expect(out(s).statusHistory.pagination).toEqual({ type: "none" });
    expect(out(s).tickets.pagination.pageSize).toBe(50);
  });

  it("validates page options", () => {
    let s = setField(fromAcme(), "tickets.pagination.values.pageSize", "0");

    expect(errorPaths(s)).toContain("tickets.pagination.values.pageSize");
    s = setField(fromAcme(), "tickets.pagination.values.param", "");
    expect(errorPaths(s)).toContain("tickets.pagination.values.param");
    s = setField(fromAcme(), "tickets.pagination.values.sizeParam", "");
    expect(errorPaths(s)).toContain("tickets.pagination.values.sizeParam");
    s = setField(fromAcme(), "tickets.pagination.values.startAt", "x");
    expect(errorPaths(s)).toContain("tickets.pagination.values.startAt");
  });

  it("preserves an unverified pagination type and its fields untouched", () => {
    const cfg = acme() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    cfg.tickets.pagination = { type: "cursor", param: "cursor", nextPath: "$.next" };
    const r = configToState(cfg);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(serialize(r.state)).tickets.pagination).toEqual(cfg.tickets.pagination);
    expect(validate(r.state).find((i) => i.path === "tickets.pagination.type")?.severity).toBe("warning");
  });

  it("estimates request volume from page size and the per-ticket endpoints", () => {
    const s = fromAcme();

    expect(estimateRequests(s, 500, 10)).toEqual({ listRequests: 10, commentRequests: 500, historyRequests: 500, total: 1010 });
    const big = setField(s, "tickets.pagination.values.pageSize", "250");

    expect(estimateRequests(big, 500, 10).listRequests).toBe(2);
    const off = setField(setField(s, "comments.enabled", false), "statusHistory.enabled", false);

    expect(estimateRequests(off, 500, 10).total).toBe(10);
    const paged = setField(setField(s, "comments.pagination.type", "page"), "comments.pagination.values.pageSize", "5");

    expect(estimateRequests(paged, 100, 10).commentRequests).toBe(200);
  });
});

describe("Comments and status history", () => {
  it("toggling adds and removes the whole section", () => {
    let s = fromAcme();

    s = setField(s, "comments.enabled", false);
    expect(out(s).comments).toBeUndefined();
    expect(out(s).statusHistory).toBeDefined();
    s = setField(s, "statusHistory.enabled", false);
    expect(out(s).statusHistory).toBeUndefined();
    s = setField(setField(s, "comments.enabled", true), "statusHistory.enabled", true);
    expect(out(s).comments).toEqual(acme().comments); // settings survive being switched off and on
    expect(out(s).statusHistory).toEqual(acme().statusHistory);
  });

  it("edits method, path, items path of each", () => {
    let s = setField(fromAcme(), "comments.request.path", "/c/{{ticket.id}}");

    s = setField(s, "comments.itemsPath", "$.c[*]");
    s = setField(s, "statusHistory.request.path", "/h/{{ticket.id}}");
    s = setField(s, "statusHistory.itemsPath", "$.h[*]");
    expect(out(s).comments.request.path).toBe("/c/{{ticket.id}}");
    expect(out(s).comments.itemsPath).toBe("$.c[*]");
    expect(out(s).statusHistory.request.path).toBe("/h/{{ticket.id}}");
    expect(out(s).statusHistory.itemsPath).toBe("$.h[*]");
  });

  it("does not validate sections that are switched off", () => {
    let s = setField(fromAcme(), "comments.request.path", "");

    expect(errorPaths(s)).toContain("comments.request.path");
    s = setField(s, "comments.enabled", false);
    expect(errorPaths(s)).toEqual([]);
  });

  it("warns when a per-ticket path lacks {{ticket.id}}", () => {
    const s = setField(fromAcme(), "comments.request.path", "/comments");

    expect(validate(s).find((i) => i.path === "comments.request.path")?.severity).toBe("warning");
  });
});

describe("Mappings", () => {
  it("every ticket, comment and history mapping field is editable and exported", () => {
    let s = fromAcme();
    const ticketKeys = Object.keys(acme().mapping);
    const commentKeys = Object.keys(acme().commentMapping);
    const historyKeys = Object.keys(acme().statusHistory.mapping);

    for (const k of ticketKeys) s = setField(s, `mapping.${k}`, `$.t_${k}`);
    for (const k of commentKeys) s = setField(s, `commentMapping.${k}`, `$.c_${k}`);
    for (const k of historyKeys) s = setField(s, `statusHistory.mapping.${k}`, `$.h_${k}`);
    expect(out(s).mapping).toEqual(Object.fromEntries(ticketKeys.map((k) => [k, `$.t_${k}`])));
    expect(out(s).commentMapping).toEqual(Object.fromEntries(commentKeys.map((k) => [k, `$.c_${k}`])));
    expect(out(s).statusHistory.mapping).toEqual(Object.fromEntries(historyKeys.map((k) => [k, `$.h_${k}`])));
    expect(ticketKeys).toHaveLength(11);
    expect(commentKeys).toHaveLength(6);
    expect(historyKeys).toHaveLength(4);
  });

  it("omits cleared optional fields, keeps cleared required ones (flagged)", () => {
    let s = setField(fromAcme(), "mapping.channel", "");

    expect(out(s).mapping.channel).toBe(""); // existing key is never removed
    expect("channel" in out(setField(defaultState(), "mapping.channel", "")).mapping).toBe(false); // never in the document
    expect(errorPaths(s)).toEqual([]);
    s = setField(s, "mapping.id", "");
    expect(out(s).mapping.id).toBe("");
    expect(errorPaths(s)).toContain("mapping.id");
    expect(errorPaths(setField(fromAcme(), "commentMapping.body", ""))).toContain("commentMapping.body");
    expect(errorPaths(setField(fromAcme(), "statusHistory.mapping.toStatus", ""))).toContain("statusHistory.mapping.toStatus");
  });

  it("requires JSONPath expressions to start with $", () => {
    expect(errorPaths(setField(fromAcme(), "mapping.title", "title"))).toContain("mapping.title");
  });
});

describe("Value maps", () => {
  it("add, edit and remove entries in each map", () => {
    for (const map of ["status", "priority", "authorRole"] as const) {
      const path = `valueMaps.${map}`;
      let s = kvAdd(fromAcme(), path, "brand_new", "target");

      expect(out(s).valueMaps[map].brand_new).toBe("target");
      const added = s.valueMaps[map].at(-1)!;

      s = kvUpdate(s, path, added.id, { key: "renamed", value: "t2" });
      expect(out(s).valueMaps[map].renamed).toBe("t2");
      expect(out(s).valueMaps[map].brand_new).toBeUndefined();
      s = kvRemove(s, path, added.id);
      expect(out(s).valueMaps[map]).toEqual(acme().valueMaps[map]);
    }
  });

  it("removing every entry omits the map", () => {
    let s = fromAcme();

    for (const e of s.valueMaps.authorRole) s = kvRemove(s, "valueMaps.authorRole", e.id);
    expect(out(s).valueMaps.authorRole).toEqual({}); // existing keys are never removed
    let d = defaultState();

    for (const m of ["status", "priority", "authorRole"] as const) for (const e of d.valueMaps[m]) d = kvRemove(d, `valueMaps.${m}`, e.id);
    expect(out(d).valueMaps).toBeUndefined(); // never in the document: omitted
  });

  it("flags duplicate keys and empty targets", () => {
    expect(errorPaths(kvAdd(fromAcme(), "valueMaps.status", "open", "x"))).toContain(`valueMaps.status.${fromAcme().valueMaps.status.length}.key`);
    expect(errorPaths(kvAdd(fromAcme(), "valueMaps.priority", "p0", ""))).toContain(`valueMaps.priority.${fromAcme().valueMaps.priority.length}.value`);
  });
});

describe("Import behaviour", () => {
  it("unknownStatus, importWindowDays, slaMode, creationActor.type and ticketUrlTemplate", () => {
    let s = fromAcme();

    s = setField(s, "unknownStatus", "skip");
    s = setField(s, "importWindowDays", "30");
    s = setField(s, "slaMode", "basic");
    s = setField(s, "creationActorType", "fixed");
    s = setField(s, "ticketUrlTemplate", "https://x.test/t/{id}");
    const o = out(s);

    expect(o).toMatchObject({ unknownStatus: "skip", importWindowDays: 30, slaMode: "basic", creationActor: { type: "fixed" }, ticketUrlTemplate: "https://x.test/t/{id}" });
    expect(typeof o.importWindowDays).toBe("number");
  });

  it("omits cleared optional settings and validates the window", () => {
    let s = setField(fromAcme(), "ticketUrlTemplate", "");

    expect(out(s).ticketUrlTemplate).toBe("");
    expect("ticketUrlTemplate" in out(defaultState())).toBe(false);
    s = setField(s, "importWindowDays", "0");
    expect(errorPaths(s)).toContain("importWindowDays");
    s = setField(s, "importWindowDays", "1.5");
    expect(errorPaths(s)).toContain("importWindowDays");
  });
});

describe("Additional fields", () => {
  it("are exported, and may not shadow a controlled field", () => {
    let s = setExtras(fromAcme(), "auth", { header: "X-Token" });

    expect(out(s).auth).toEqual({ type: "bearer", header: "X-Token" });
    s = setExtras(s, "auth", { type: "other" });
    expect(out(s).auth).toEqual({ type: "bearer" });
    expect(errorPaths(s)).toContain("extras.auth");
    expect(out(setExtras(s, "auth", {})).auth).toEqual({ type: "bearer" });
  });
});

describe("Generated JSON matches the UI state", () => {
  it("every edit is visible in the very next export, and invalid JSON types never appear", () => {
    let s = defaultState();
    const seen: string[] = [serialize(s)];

    for (const [path, value] of [
      ["displayName", "A"], ["tickets.pagination.type", "page"], ["tickets.pagination.values.param", "page"],
      ["comments.enabled", true], ["statusHistory.enabled", true], ["mapping.channel", "$.ch"],
    ] as const) {
      s = setField(s, path, value);
      seen.push(serialize(s));
      expect(seen.at(-1)).not.toBe(seen.at(-2));
      expect(() => JSON.parse(seen.at(-1)!)).not.toThrow();
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("export -> import -> export is stable for arbitrary edited states", () => {
    let s = fromAcme();

    s = setField(s, "tickets.pagination.values.pageSize", "10");
    s = kvAdd(s, "tickets.request.query", "q", "x");
    s = kvAdd(s, "valueMaps.status", "weird", "open");
    s = setField(s, "comments.enabled", false);
    s = setExtras(s, "", { note: { a: [1, 2, true, null] } });
    const text = serialize(s);
    const back = importConfig(text);

    expect(back.ok && serialize(back.state)).toBe(text);
  });
});

describe("Validation of invalid documents", () => {
  it("rejects non-objects and reports issues for an empty object", () => {
    expect(checkConfig([]).ok).toBe(false);
    expect(checkConfig("x").error).toBeTruthy();
    const empty = checkConfig({});

    expect(empty.ok).toBe(false);
    expect(empty.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["schemaVersion", "displayName", "baseUrl", "authType", "tickets.request.path", "mapping.id"]));
  });

  it("accepts the Acme document and flags a broken variant of it", () => {
    expect(checkConfig(acme()).ok).toBe(true);
    const bad = acme() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    bad.tickets.pagination.pageSize = 0;
    bad.connection.baseUrl = "nope";
    bad.mapping.title = "title";
    const res = checkConfig(bad);

    expect(res.ok).toBe(false);
    expect(errorsOf(res.issues).map((i) => i.path)).toEqual(expect.arrayContaining(["tickets.pagination.values.pageSize", "baseUrl", "mapping.title"]));
  });
});

describe("Lossless round trip (import -> export)", () => {
  const variants: Record<string, (c: any) => void> = { // eslint-disable-line @typescript-eslint/no-explicit-any
    "optional mapping present but empty": (c) => { c.mapping.channel = ""; },
    "empty query object": (c) => { c.tickets.request.query = {}; },
    "empty incremental object": (c) => { c.tickets.incremental = {}; },
    "empty value map objects": (c) => { c.valueMaps.status = {}; c.valueMaps.priority = {}; },
    "empty valueMaps object": (c) => { c.valueMaps = {}; },
    "empty pagination object": (c) => { c.comments.pagination = {}; },
    "numeric strings": (c) => { c.importWindowDays = "90"; c.schemaVersion = "1"; c.tickets.incremental.lookbackSeconds = "300"; },
    "number and boolean query values": (c) => { c.tickets.request.query.limit = 50; c.tickets.request.query.flag = true; c.tickets.request.query.off = false; },
    "number and boolean value-map values": (c) => { c.valueMaps.priority.low = 1; c.valueMaps.status.x = true; },
    "key order": (c) => { c.mapping = { channel: c.mapping.channel, ...c.mapping }; c.tickets = { pagination: c.tickets.pagination, ...c.tickets }; c.valueMaps = { authorRole: c.valueMaps.authorRole, ...c.valueMaps }; },
    "unknown pagination type": (c) => { c.tickets.pagination = { type: "cursor", cursorParam: "c", limit: 25, flag: true }; },
    "none with leftover keys": (c) => { c.comments.pagination = { type: "none", param: "page", pageSize: 10 }; },
    "non-string known values": (c) => { c.mapping.id = { path: "$.id" }; c.displayName = 42; },
    "unknown keys at every level": (c) => { c.auth.x = 1; c.connection.y = [1]; c.creationActor.z = null; c.statusHistory.mapping.extra = "$.e"; },
    "no optional sections": (c) => { delete c.comments; delete c.statusHistory; delete c.tickets.incremental; delete c.valueMaps; delete c.ticketUrlTemplate; },
  };

  for (const [name, mutate] of Object.entries(variants)) {
    it(`preserves: ${name} (values, types, structure and key order)`, () => {
      const cfg = acme() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

      mutate(cfg);
      const r = configToState(cfg);

      expect(r.ok).toBe(true);
      if (r.ok) expect(serialize(r.state)).toBe(JSON.stringify(cfg, null, 2));
    });
  }

  it("a single edit changes only that value; everything else is untouched", () => {
    const cfg = acme() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    cfg.mapping = { channel: "", ...cfg.mapping };
    cfg.tickets.request.query.limit = 50;
    const r = configToState(cfg);

    if (!r.ok) throw new Error(r.error);
    const edited = JSON.parse(serialize(setField(r.state, "tickets.pagination.values.pageSize", "100")));
    const expected = JSON.parse(JSON.stringify(cfg));

    expected.tickets.pagination.pageSize = 100;
    expect(edited).toEqual(expected);
    expect(Object.keys(edited.mapping)).toEqual(Object.keys(cfg.mapping));
  });

  it("typed query / value-map entries keep their JSON type when edited", () => {
    const cfg = acme() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    cfg.tickets.request.query.limit = 50;
    cfg.tickets.request.query.flag = true;
    const r = configToState(cfg);

    if (!r.ok) throw new Error(r.error);
    const [, limit, flag] = r.state.tickets.request.query;

    expect([limit.kind, flag.kind]).toEqual(["number", "boolean"]);
    let s = kvUpdate(r.state, "tickets.request.query", limit.id, { value: "75" });

    s = kvUpdate(s, "tickets.request.query", flag.id, { value: "false" });
    expect(out(s).tickets.request.query).toMatchObject({ limit: 75, flag: false });
    s = kvUpdate(s, "tickets.request.query", limit.id, { kind: "string" });
    expect(out(s).tickets.request.query.limit).toBe("75");
    expect(errorPaths(kvUpdate(r.state, "tickets.request.query", limit.id, { value: "abc" }))).toContain("tickets.request.query.1.value");
    expect(errorPaths(kvUpdate(r.state, "tickets.request.query", flag.id, { value: "maybe" }))).toContain("tickets.request.query.2.value");
  });

  it("a value the form cannot show is not reported as missing, and stays editable as its own type", () => {
    const cfg = acme() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    cfg.mapping.id = { path: "$.id" };
    cfg.displayName = 42;
    const r = configToState(cfg);

    if (!r.ok) throw new Error(r.error);
    expect(errorPaths(r.state)).toEqual([]);
    const s = setExtras(r.state, "", { displayName: 43 });

    expect(out(s).displayName).toBe(43);
  });
});
