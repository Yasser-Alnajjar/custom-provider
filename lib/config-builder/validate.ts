import {
  COMMENT_MAPPING,
  HISTORY_MAPPING,
  KNOWN_VALUES,
  TICKET_MAPPING,
  VALUE_MAPS,
  paginationType,
  type MapFieldDef,
} from "./contract";
import { configToState, getIn, toConfig, type BuilderState, type EndpointState, type KV } from "./model";

export type Severity = "error" | "warning";

export interface Issue {
  /** The state path of the field the message belongs to (same path the UI control uses). */
  path: string;
  severity: Severity;
  message: string;
}

/** The JSON path of the document key behind a form path (they differ only for a few fields). */
function jsonPath(p: string): string {
  const fixed: Record<string, string> = { baseUrl: "connection.baseUrl", authType: "auth.type", creationActorType: "creationActor.type" };

  if (fixed[p]) return fixed[p];
  if (p.startsWith("incremental.")) return `tickets.${p}`;
  return p.replace(".values.", ".");
}

/** True when the document has a value at this key that the form cannot show (kept under Additional fields). */
function hasExtra(s: BuilderState, formPath: string): boolean {
  const jp = jsonPath(formPath);
  const i = jp.lastIndexOf(".");

  return (i < 0 ? "" : jp.slice(0, i)) in s.extras && jp.slice(i + 1) in s.extras[i < 0 ? "" : jp.slice(0, i)];
}

const isInt = (v: string) => /^-?\d+$/.test(v.trim());

export function validate(s: BuilderState): Issue[] {
  const issues: Issue[] = [];
  const err = (path: string, message: string) => issues.push({ path, severity: "error", message });
  const warn = (path: string, message: string) => issues.push({ path, severity: "warning", message });

  const required = (path: string, v: string, label: string) => {
    if (v.trim() === "" && !hasExtra(s, path)) err(path, `${label} is required.`);
    return v.trim() !== "";
  };

  const oneOf = (path: string, v: string, known: readonly string[], label: string) => {
    if (v.trim() !== "" && !known.includes(v)) warn(path, `"${v}" is not a ${label} used by the reference configuration (${known.join(", ")}); confirm Elapsed supports it.`);
  };

  const integer = (path: string, v: string, label: string, min: number) => {
    if (v.trim() === "") return;
    if (!isInt(v)) err(path, `${label} must be a whole number.`);
    else if (Number(v) < min) err(path, `${label} must be at least ${min}.`);
  };

  const kvs = (path: string, entries: KV[], label: string) => {
    const seen = new Set<string>();

    entries.forEach((e, i) => {
      const key = e.key.trim();

      if (e.kind === "number" && e.value.trim() !== "" && !Number.isFinite(Number(e.value))) err(`${path}.${i}.value`, "Not a valid number; choose another type or fix the value.");
      if (e.kind === "boolean" && e.value !== "true" && e.value !== "false") err(`${path}.${i}.value`, "A boolean must be true or false.");
      if (key === "") {
        if (e.value !== "") err(`${path}.${i}.key`, `${label} name is required.`);
      } else if (seen.has(key)) err(`${path}.${i}.key`, `Duplicate ${label.toLowerCase()} "${key}"; only the last value would be exported.`);
      else seen.add(key);
    });
  };

  const mapping = (path: string, record: Record<string, string>, defs: MapFieldDef[]) => {
    for (const d of defs) {
      const v = record[d.key] ?? "";
      const p = `${path}.${d.key}`;

      if (v.trim() === "") {
        if (d.required && !hasExtra(s, p)) err(p, `${d.label} is required.`);
      } else if (!v.trim().startsWith("$")) err(p, "A JSONPath expression must start with $ (for example $.id).");
    }
  };

  const endpoint = (path: string, e: EndpointState, label: string, perTicket: boolean) => {
    required(`${path}.request.method`, e.request.method, "HTTP method");
    oneOf(`${path}.request.method`, e.request.method, KNOWN_VALUES.method, "HTTP method");
    if (required(`${path}.request.path`, e.request.path, "Request path") && !/^(\/|https?:\/\/)/.test(e.request.path.trim())) {
      err(`${path}.request.path`, "The path must start with / (or be an absolute http(s) URL).");
    }
    if (perTicket && e.request.path.trim() !== "" && !e.request.path.includes("{{ticket.id}}")) {
      warn(`${path}.request.path`, `${label} are fetched per ticket; the path normally contains {{ticket.id}}.`);
    }
    kvs(`${path}.request.query`, e.request.query, "Query parameter");
    if (required(`${path}.itemsPath`, e.itemsPath, "Items path") && !e.itemsPath.trim().startsWith("$")) {
      err(`${path}.itemsPath`, "A JSONPath expression must start with $ (for example $.data.items[*]).");
    }

    const p = e.pagination;
    const def = paginationType(p.type);

    if (p.type === "") warn(`${path}.pagination.type`, "Pagination is not set; the runtime default applies.");
    else if (!def) warn(`${path}.pagination.type`, `Pagination type "${p.type}" is not one this builder verifies; its fields are only preserved.`);
    for (const param of def?.params ?? []) {
      const v = p.values[param.key] ?? "";
      const at = `${path}.pagination.values.${param.key}`;

      if (param.required) required(at, v, param.label);
      if (param.kind === "int") integer(at, v, param.label, param.min ?? 0);
    }
    if (def?.value === "page") {
      const size = (p.values.pageSize ?? "").trim();
      const sizeParam = (p.values.sizeParam ?? "").trim();

      if (size && !sizeParam) err(`${path}.pagination.values.sizeParam`, "Required when a page size is set.");
      if (sizeParam && !size) err(`${path}.pagination.values.pageSize`, "Required when a page size parameter is set.");
    }
  };

  // General
  if (required("schemaVersion", s.schemaVersion, "Schema version")) integer("schemaVersion", s.schemaVersion, "Schema version", 1);
  required("displayName", s.displayName, "Display name");
  if (required("baseUrl", s.baseUrl, "Base URL")) {
    try {
      const u = new URL(s.baseUrl.trim());

      if (u.protocol !== "http:" && u.protocol !== "https:") err("baseUrl", "The base URL must use http or https.");
    } catch {
      err("baseUrl", "Enter a valid absolute URL, for example https://api.example.com.");
    }
  }
  if (required("authType", s.authType, "Authentication type")) oneOf("authType", s.authType, KNOWN_VALUES.authType, "authentication type");

  // Tickets
  endpoint("tickets", s.tickets, "Tickets", false);
  const usesUpdatedSince = s.tickets.request.query.some((q) => q.value.includes("{{updatedSince}}"));

  if (s.incremental.enabled) {
    integer("incremental.lookbackSeconds", s.incremental.lookbackSeconds, "Lookback", 0);
    oneOf("incremental.format", s.incremental.format, KNOWN_VALUES.incrementalFormat, "timestamp format");
    if (!usesUpdatedSince) warn("incremental.enabled", "Incremental sync is on but no ticket query parameter uses {{updatedSince}}, so the provider cannot filter by time.");
  } else if (usesUpdatedSince) {
    warn("incremental.enabled", "A query parameter uses {{updatedSince}} but incremental sync is off.");
  }

  // Optional endpoints
  if (s.comments.enabled) endpoint("comments", s.comments, "Comments", true);
  if (s.statusHistory.enabled) {
    endpoint("statusHistory", s.statusHistory, "Status history entries", true);
    mapping("statusHistory.mapping", s.statusHistory.mapping, HISTORY_MAPPING);
  }

  // Mappings
  mapping("mapping", s.mapping, TICKET_MAPPING);
  if (s.comments.enabled) mapping("commentMapping", s.commentMapping, COMMENT_MAPPING);

  // Value maps
  for (const m of VALUE_MAPS) {
    kvs(`valueMaps.${m.key}`, s.valueMaps[m.key], `${m.label} value`);
    s.valueMaps[m.key].forEach((e, i) => {
      if (e.key.trim() !== "" && e.value.trim() === "") err(`valueMaps.${m.key}.${i}.value`, "Target value is required.");
    });
  }

  // Import behaviour
  integer("importWindowDays", s.importWindowDays, "Import window", 1);
  oneOf("unknownStatus", s.unknownStatus, KNOWN_VALUES.unknownStatus, "unknown-status behaviour");
  oneOf("slaMode", s.slaMode, KNOWN_VALUES.slaMode, "SLA mode");
  oneOf("creationActorType", s.creationActorType, KNOWN_VALUES.creationActorType, "creation actor type");
  if (s.ticketUrlTemplate.trim() !== "" && !s.ticketUrlTemplate.includes("{id}")) warn("ticketUrlTemplate", "The template does not contain {id}, so every ticket links to the same URL.");

  // Additional fields must not shadow a field the builder controls.
  const controlled = toConfig(s, { withoutExtras: true });

  for (const [path, extra] of Object.entries(s.extras)) {
    const owner = path === "" ? controlled : getIn(controlled, path);

    if (owner && typeof owner === "object") {
      for (const key of Object.keys(extra)) {
        if (key in owner && (owner as Record<string, unknown>)[key] !== "") err(`extras.${path}`, `"${key}" is controlled by a field above; remove it from the additional fields${path ? ` of ${path}` : ""}.`);
      }
    }
  }

  return issues;
}

export const errorsOf = (issues: Issue[]) => issues.filter((i) => i.severity === "error");

/** Issues keyed by field path (first message wins, errors beat warnings), for rendering next to controls. */
export function issueMap(issues: Issue[]): Record<string, Issue> {
  const out: Record<string, Issue> = {};

  for (const i of issues) if (!out[i.path] || (out[i.path].severity === "warning" && i.severity === "error")) out[i.path] = i;
  return out;
}

/** Validates a raw configuration document: import it, then run the same checks the UI runs. */
export function checkConfig(raw: unknown): { ok: boolean; issues: Issue[]; error?: string } {
  const res = configToState(raw);

  if (!res.ok) return { ok: false, issues: [], error: res.error };
  const issues = validate(res.state);

  return { ok: errorsOf(issues).length === 0, issues };
}
