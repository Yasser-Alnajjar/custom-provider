import {
  COMMENT_MAPPING,
  HISTORY_MAPPING,
  PAGINATION_TYPES,
  TICKET_MAPPING,
  VALUE_MAPS,
  paginationType,
  type ValueMapKey,
} from "./contract";

type Obj = Record<string, unknown>;

/** JSON type of a key/value entry's value, so numbers and booleans keep their type. */
export type ValueKind = "string" | "number" | "boolean";

export interface KV {
  /** UI identity only; never exported. */
  id: string;
  key: string;
  /** Edited as text; exported according to `kind`. */
  value: string;
  kind: ValueKind;
}

export interface PaginationState {
  /** "" = not set (the `pagination` object is omitted). */
  type: string;
  /** Parameter values for every known pagination type, as text. Only the active type's are exported. */
  values: Record<string, string>;
}

export interface EndpointState {
  request: { method: string; path: string; query: KV[] };
  itemsPath: string;
  pagination: PaginationState;
}

export interface BuilderState {
  schemaVersion: string;
  displayName: string;
  baseUrl: string;
  authType: string;
  tickets: EndpointState;
  incremental: { enabled: boolean; format: string; lookbackSeconds: string };
  comments: EndpointState & { enabled: boolean };
  statusHistory: EndpointState & { enabled: boolean; mapping: Record<string, string> };
  mapping: Record<string, string>;
  commentMapping: Record<string, string>;
  valueMaps: Record<ValueMapKey, KV[]>;
  unknownStatus: string;
  importWindowDays: string;
  slaMode: string;
  creationActorType: string;
  ticketUrlTemplate: string;
  /**
   * Keys found on import (or typed in "Additional fields") that the builder has no control for,
   * grouped by the JSON object path they belong to ("" = document root). They are written back
   * unchanged, so nothing is silently discarded.
   */
  extras: Record<string, Obj>;
  /** JSON paths of keys that existed in the imported document. They are always written back (even when empty). */
  present: Record<string, true>;
  /** JSON paths of numeric fields that were strings in the imported document; they stay strings. */
  asString: Record<string, true>;
  /** Key order of every object in the imported document, so the export keeps it. */
  order: Record<string, string[]>;
}

let counter = 0;
export const uid = () => `kv${++counter}`;
export const kv = (key = "", value = "", kind: ValueKind = "string"): KV => ({ id: uid(), key, value, kind });

const blankRecord = (defs: { key: string }[]) => Object.fromEntries(defs.map((d) => [d.key, ""]));

function emptyPagination(type = ""): PaginationState {
  const values: Record<string, string> = {};

  for (const t of PAGINATION_TYPES) for (const p of t.params) values[p.key] = "";
  return { type, values };
}

const emptyEndpoint = (): EndpointState => ({
  request: { method: "", path: "", query: [] },
  itemsPath: "",
  pagination: emptyPagination(),
});

/** Every field blank, optional sections off. The starting point for imports. */
export function emptyState(): BuilderState {
  return {
    schemaVersion: "",
    displayName: "",
    baseUrl: "",
    authType: "",
    tickets: emptyEndpoint(),
    incremental: { enabled: false, format: "", lookbackSeconds: "" },
    comments: { ...emptyEndpoint(), enabled: false },
    statusHistory: { ...emptyEndpoint(), enabled: false, mapping: blankRecord(HISTORY_MAPPING) },
    mapping: blankRecord(TICKET_MAPPING),
    commentMapping: blankRecord(COMMENT_MAPPING),
    valueMaps: { status: [], priority: [], authorRole: [] },
    unknownStatus: "",
    importWindowDays: "",
    slaMode: "",
    creationActorType: "",
    ticketUrlTemplate: "",
    extras: {},
    present: {},
    asString: {},
    order: {},
  };
}

const identity = (...keys: string[]) => keys.map((k) => kv(k, k));

/** A generic, valid starting template ("Reset to Defaults"). Not tied to Acme Desk. */
export function defaultState(baseUrl = "https://api.example.com"): BuilderState {
  const s = emptyState();

  s.schemaVersion = "1";
  s.displayName = "My Ticket Provider";
  s.baseUrl = baseUrl;
  s.authType = "bearer";
  s.tickets = {
    request: { method: "GET", path: "/tickets", query: [] },
    itemsPath: "$.items[*]",
    pagination: { ...emptyPagination("none") },
  };
  s.incremental = { enabled: false, format: "iso8601", lookbackSeconds: "300" };
  s.comments = {
    enabled: false,
    request: { method: "GET", path: "/tickets/{{ticket.id}}/comments", query: [] },
    itemsPath: "$.items[*]",
    pagination: emptyPagination("none"),
  };
  s.statusHistory = {
    enabled: false,
    request: { method: "GET", path: "/tickets/{{ticket.id}}/history", query: [] },
    itemsPath: "$.items[*]",
    pagination: emptyPagination("none"),
    mapping: { id: "$.id", changedAt: "$.created_at", toStatus: "$.to", fromStatus: "$.from" },
  };
  s.mapping = { ...s.mapping, id: "$.id", createdAt: "$.created_at", status: "$.status", title: "$.title", updatedAt: "$.updated_at" };
  s.commentMapping = { ...s.commentMapping, id: "$.id", createdAt: "$.created_at", authorRole: "$.author.role", body: "$.body" };
  s.valueMaps = {
    status: identity("new", "open", "pending", "in_progress", "resolved", "closed"),
    priority: identity("low", "normal", "high", "urgent"),
    authorRole: identity("customer", "agent", "system"),
  };
  s.unknownStatus = "fail";
  s.importWindowDays = "90";
  s.slaMode = "full";
  s.creationActorType = "first_comment_author";
  return s;
}

/* ------------------------------------------------------------------ */
/* Immutable edits: the UI and the tests drive state through these.     */
/* ------------------------------------------------------------------ */

export function getIn(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Obj)[k] : undefined), obj);
}

export function setIn<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".");
  const next = rest.length ? setIn((obj as Obj)[head], rest.join("."), value) : value;

  return { ...(obj as Obj), [head]: next } as T;
}

export const setField = (s: BuilderState, path: string, value: string | boolean): BuilderState => setIn(s, path, value);

const list = (s: BuilderState, path: string) => (getIn(s, path) as KV[]) ?? [];

export const kvAdd = (s: BuilderState, path: string, key = "", value = "", kind: ValueKind = "string"): BuilderState =>
  setIn(s, path, [...list(s, path), kv(key, value, kind)]);

export const kvUpdate = (s: BuilderState, path: string, id: string, patch: Partial<Pick<KV, "key" | "value" | "kind">>): BuilderState =>
  setIn(s, path, list(s, path).map((e) => (e.id === id ? { ...e, ...patch } : e)));

export const kvRemove = (s: BuilderState, path: string, id: string): BuilderState =>
  setIn(s, path, list(s, path).filter((e) => e.id !== id));

/** Replaces the unmanaged ("additional") fields of one JSON object. An empty object removes them. */
export function setExtras(s: BuilderState, objectPath: string, value: Obj): BuilderState {
  const extras = { ...s.extras };

  if (Object.keys(value).length) extras[objectPath] = value;
  else delete extras[objectPath];
  return { ...s, extras };
}

/* ------------------------------------------------------------------ */
/* State -> JSON                                                        */
/* ------------------------------------------------------------------ */

/** A number when the text is numeric; otherwise the raw text, so an invalid entry stays visible (and is flagged). */
const num = (v: string): number | string => (v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v);

const present = (v: string) => v.trim() !== "";

const kvValue = (e: KV): unknown => {
  if (e.kind === "number") return num(e.value);
  if (e.kind === "boolean") return e.value === "true" ? true : e.value === "false" ? false : e.value;
  return e.value;
};

export function kvToObject(entries: KV[]): Obj {
  const out: Obj = {};

  for (const e of entries) if (e.key.trim() !== "") out[e.key.trim()] = kvValue(e);
  return out;
}

export interface ToConfigOptions {
  /** Leave out the preserved extras; used to find which keys the builder itself controls. */
  withoutExtras?: boolean;
}

export function toConfig(s: BuilderState, opts: ToConfigOptions = {}): Obj {
  const has = (path: string) => !!s.present[path];
  /** Numbers stay numbers unless the imported document had that field as a string. */
  const typed = (path: string, v: string): unknown => (s.asString[path] ? v : num(v));

  /** Adds preserved keys that the builder did not write itself. */
  const ext = (path: string, base: Obj): Obj => {
    const extra = opts.withoutExtras ? undefined : s.extras[path];

    // A blank known field is only a placeholder, so a preserved value of the same key (one the
    // form cannot represent, e.g. an object where a string is expected) may take its place.
    if (extra) for (const [k, v] of Object.entries(extra)) if (!(k in base) || base[k] === "") base[k] = v;
    return base;
  };

  const pagination = (path: string, p: PaginationState): Obj | undefined => {
    if (p.type === "") return ext(path, {}) as Obj | undefined;
    const out: Obj = { type: p.type };

    for (const def of paginationType(p.type)?.params ?? []) {
      const v = p.values[def.key] ?? "";

      if (def.required || present(v) || has(`${path}.${def.key}`)) out[def.key] = def.kind === "int" ? typed(`${path}.${def.key}`, v) : v;
    }
    return ext(path, out);
  };

  const endpoint = (path: string, e: EndpointState): Obj => {
    const query = ext(`${path}.request.query`, kvToObject(e.request.query));
    const request = ext(`${path}.request`, {
      method: e.request.method,
      path: e.request.path,
      ...(Object.keys(query).length || has(`${path}.request.query`) ? { query } : {}),
    });
    const out: Obj = { request, itemsPath: e.itemsPath };
    const pg = pagination(`${path}.pagination`, e.pagination);

    if (pg && (Object.keys(pg).length || has(`${path}.pagination`))) out.pagination = pg;
    return out;
  };

  const mapped = (path: string, record: Record<string, string>, defs: { key: string; required: boolean }[]): Obj => {
    const out: Obj = {};

    for (const d of defs) if (d.required || present(record[d.key] ?? "") || has(`${path}.${d.key}`)) out[d.key] = record[d.key] ?? "";
    return ext(path, out);
  };

  const root: Obj = {
    schemaVersion: typed("schemaVersion", s.schemaVersion),
    displayName: s.displayName,
    connection: ext("connection", { baseUrl: s.baseUrl }),
    auth: ext("auth", { type: s.authType }),
  };

  const tickets = endpoint("tickets", s.tickets);

  if (s.incremental.enabled) {
    const inc: Obj = {};

    if (present(s.incremental.format) || has("tickets.incremental.format")) inc.format = s.incremental.format;
    if (present(s.incremental.lookbackSeconds) || has("tickets.incremental.lookbackSeconds")) inc.lookbackSeconds = typed("tickets.incremental.lookbackSeconds", s.incremental.lookbackSeconds);
    tickets.incremental = ext("tickets.incremental", inc);
  }
  root.tickets = ext("tickets", tickets);

  if (s.comments.enabled) root.comments = ext("comments", endpoint("comments", s.comments));
  if (s.statusHistory.enabled) {
    const h = endpoint("statusHistory", s.statusHistory);

    h.mapping = mapped("statusHistory.mapping", s.statusHistory.mapping, HISTORY_MAPPING);
    root.statusHistory = ext("statusHistory", h);
  }

  root.mapping = mapped("mapping", s.mapping, TICKET_MAPPING);
  root.commentMapping = mapped("commentMapping", s.commentMapping, COMMENT_MAPPING);

  const valueMaps: Obj = {};

  for (const m of VALUE_MAPS) {
    const o = ext(`valueMaps.${m.key}`, kvToObject(s.valueMaps[m.key]));

    if (Object.keys(o).length || has(`valueMaps.${m.key}`)) valueMaps[m.key] = o;
  }
  const vm = ext("valueMaps", valueMaps);

  if (Object.keys(vm).length || has("valueMaps")) root.valueMaps = vm;

  if (present(s.unknownStatus) || has("unknownStatus")) root.unknownStatus = s.unknownStatus;
  if (present(s.importWindowDays) || has("importWindowDays")) root.importWindowDays = typed("importWindowDays", s.importWindowDays);
  if (present(s.slaMode) || has("slaMode")) root.slaMode = s.slaMode;
  const actor = ext("creationActor", present(s.creationActorType) || has("creationActor.type") ? { type: s.creationActorType } : {});

  if (Object.keys(actor).length || has("creationActor")) root.creationActor = actor;
  if (present(s.ticketUrlTemplate) || has("ticketUrlTemplate")) root.ticketUrlTemplate = s.ticketUrlTemplate;

  return reorder(ext("", root), s.order, "");
}

/** Puts keys in the order recorded at import; keys without a recorded position follow in their generated order. */
function reorder(o: Obj, order: Record<string, string[]>, path: string): Obj {
  const want = order[path] ?? [];
  const keys = Object.keys(o);
  const out: Obj = {};

  for (const k of [...want.filter((k) => k in o), ...keys.filter((k) => !want.includes(k))]) {
    const v = o[k];

    out[k] = isObj(v) ? reorder(v, order, path ? `${path}.${k}` : k) : v;
  }
  return out;
}

export const serialize = (s: BuilderState) => JSON.stringify(toConfig(s), null, 2);

/* ------------------------------------------------------------------ */
/* JSON -> state                                                        */
/* ------------------------------------------------------------------ */

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

class Reader {
  extras: Record<string, Obj> = {};
  notes: string[] = [];
  present: Record<string, true> = {};
  asString: Record<string, true> = {};

  /** Takes an object child out of `parent`. A non-object value stays on the parent (so it is preserved) and is reported. */
  obj(parent: Obj, key: string, path: string): Obj | undefined {
    const v = parent[key];

    if (v === undefined) return undefined;
    if (!isObj(v)) {
      this.notes.push(`${join(path, key)}: expected an object; kept unchanged as an additional field.`);
      return undefined;
    }
    delete parent[key];
    this.present[join(path, key)] = true;
    return { ...v };
  }

  str(o: Obj, key: string, path: string): string {
    const v = o[key];

    if (v === undefined) return "";
    if (typeof v !== "string") {
      this.notes.push(`${join(path, key)}: expected a string; kept unchanged as an additional field.`);
      return "";
    }
    delete o[key];
    this.present[join(path, key)] = true;
    return v;
  }

  num(o: Obj, key: string, path: string): string {
    const v = o[key];

    if (v === undefined) return "";
    if (typeof v === "number" && Number.isFinite(v)) {
      delete o[key];
      this.present[join(path, key)] = true;
      return String(v);
    }
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      // Edited as a number would be, but written back as the string it was.
      delete o[key];
      this.present[join(path, key)] = true;
      this.asString[join(path, key)] = true;
      return v;
    }
    this.notes.push(`${join(path, key)}: expected a number; kept unchanged as an additional field.`);
    return "";
  }

  /** Key/value object. Entries whose value is not a string stay in the additional fields of `path`. */
  kvs(parent: Obj, key: string, parentPath: string): KV[] {
    const p = join(parentPath, key);
    const o = this.obj(parent, key, parentPath);

    if (!o) return [];
    const out: KV[] = [];

    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out.push(kv(k, String(v), typeof v as ValueKind));
        delete o[k];
      } else this.notes.push(`${join(p, k)}: value is an object, array or null; kept unchanged as an additional field.`);
    }
    this.done(o, p);
    return out;
  }

  pagination(parent: Obj, parentPath: string): PaginationState {
    const path = join(parentPath, "pagination");
    const o = this.obj(parent, "pagination", parentPath);
    const state = emptyPagination();

    if (!o) return state;
    state.type = this.str(o, "type", path);
    const def = paginationType(state.type);

    if (def) for (const p of def.params) state.values[p.key] = p.kind === "int" ? this.num(o, p.key, path) : this.str(o, p.key, path);
    else if (state.type) this.notes.push(`${path}.type "${state.type}" is not a pagination type this builder verifies; its fields are preserved unchanged as additional fields.`);
    this.done(o, path);
    return state;
  }

  done(o: Obj | undefined, path: string) {
    if (o && Object.keys(o).length) this.extras[path] = { ...(this.extras[path] ?? {}), ...o };
  }
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

export type ImportResult = { ok: true; state: BuilderState; notes: string[] } | { ok: false; error: string };

function recordOrder(v: unknown, path: string, into: Record<string, string[]>) {
  if (!isObj(v)) return;
  into[path] = Object.keys(v);
  for (const [k, child] of Object.entries(v)) recordOrder(child, path ? `${path}.${k}` : k, into);
}

/** Parses a configuration document into builder state. Unknown or mistyped fields are kept as additional fields. */
export function configToState(raw: unknown): ImportResult {
  if (!isObj(raw)) return { ok: false, error: "The configuration must be a JSON object." };

  const r = new Reader();
  const root: Obj = { ...raw };
  const base = emptyState();
  const defaults = defaultState();
  const s = base;

  s.schemaVersion = r.num(root, "schemaVersion", "");
  s.displayName = r.str(root, "displayName", "");

  const connection = r.obj(root, "connection", "") ?? {};

  s.baseUrl = r.str(connection, "baseUrl", "connection");
  r.done(connection, "connection");

  const auth = r.obj(root, "auth", "") ?? {};

  s.authType = r.str(auth, "type", "auth");
  r.done(auth, "auth");

  const readEndpoint = (path: string, sec: Obj): EndpointState => {
    const req = r.obj(sec, "request", path) ?? {};
    const e: EndpointState = {
      request: {
        method: r.str(req, "method", `${path}.request`),
        path: r.str(req, "path", `${path}.request`),
        query: r.kvs(req, "query", `${path}.request`),
      },
      itemsPath: r.str(sec, "itemsPath", path),
      pagination: r.pagination(sec, path),
    };

    r.done(req, `${path}.request`);
    return e;
  };

  const readMapping = (parent: Obj, parentPath: string, key: string, defs: { key: string }[]) => {
    const path = join(parentPath, key);
    const o = r.obj(parent, key, parentPath) ?? {};
    const out = blankRecord(defs);

    for (const d of defs) out[d.key] = r.str(o, d.key, path);
    r.done(o, path);
    return out;
  };

  const tickets = r.obj(root, "tickets", "") ?? {};

  s.tickets = readEndpoint("tickets", tickets);
  const inc = r.obj(tickets, "incremental", "tickets");

  if (inc) {
    s.incremental = { enabled: true, format: r.str(inc, "format", "tickets.incremental"), lookbackSeconds: r.num(inc, "lookbackSeconds", "tickets.incremental") };
    r.done(inc, "tickets.incremental");
  } else s.incremental = { ...defaults.incremental, enabled: false };
  r.done(tickets, "tickets");

  const comments = r.obj(root, "comments", "");

  if (comments) {
    s.comments = { ...readEndpoint("comments", comments), enabled: true };
    r.done(comments, "comments");
  } else s.comments = { ...defaults.comments, enabled: false };

  const history = r.obj(root, "statusHistory", "");

  if (history) {
    const e = readEndpoint("statusHistory", history);

    s.statusHistory = { ...e, enabled: true, mapping: readMapping(history, "statusHistory", "mapping", HISTORY_MAPPING) };
    r.done(history, "statusHistory");
  } else s.statusHistory = { ...defaults.statusHistory, enabled: false };

  s.mapping = readMapping(root, "", "mapping", TICKET_MAPPING);
  s.commentMapping = readMapping(root, "", "commentMapping", COMMENT_MAPPING);

  const valueMaps = r.obj(root, "valueMaps", "");

  if (valueMaps) {
    for (const m of VALUE_MAPS) s.valueMaps[m.key] = r.kvs(valueMaps, m.key, "valueMaps");
    r.done(valueMaps, "valueMaps");
  }

  s.unknownStatus = r.str(root, "unknownStatus", "");
  s.importWindowDays = r.num(root, "importWindowDays", "");
  s.slaMode = r.str(root, "slaMode", "");

  const actor = r.obj(root, "creationActor", "");

  if (actor) {
    s.creationActorType = r.str(actor, "type", "creationActor");
    r.done(actor, "creationActor");
  }
  s.ticketUrlTemplate = r.str(root, "ticketUrlTemplate", "");
  r.done(root, "");

  s.extras = r.extras;
  s.present = r.present;
  s.asString = r.asString;
  s.order = {};
  recordOrder(raw, "", s.order);
  for (const [path, o] of Object.entries(r.extras)) {
    const where = path || "the document root";

    r.notes.push(`Preserved ${Object.keys(o).length} additional field(s) on ${where}: ${Object.keys(o).join(", ")}.`);
  }
  return { ok: true, state: s, notes: r.notes };
}

/** Parses JSON text and converts it to builder state. */
export function importConfig(text: string): ImportResult {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  return configToState(raw);
}
