/**
 * Declarative description of the Elapsed "Custom REST" configuration document.
 *
 * This is the single place the UI, the validator, the importer and the exporter read from.
 * Everything here is taken from the reference document this lab already serves
 * (`lib/server/elapsed-config.ts`). Where the Elapsed runtime might accept more (further
 * pagination types, auth types, enum values) it is NOT listed: the builder still lets such
 * values through (free text with suggestions, and preserved on import) but flags them as
 * "not verified" instead of pretending they are supported. To expose a new option, add it here
 * once its support is confirmed in Elapsed's `packages/custom-ticket` schema.
 */

export type FieldKind = "string" | "int";

export interface ParamDef {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  min?: number;
  help: string;
  /** The value changes how many HTTP requests a sync makes. */
  volume?: boolean;
  placeholder?: string;
}

export interface PaginationType {
  value: string;
  label: string;
  help: string;
  params: ParamDef[];
}

export const PAGINATION_TYPES: PaginationType[] = [
  { value: "none", label: "None (single request)", help: "One request per call; all items must come back in the first response.", params: [] },
  {
    value: "page",
    label: "Page number",
    help: "Sends the page number in a query parameter (first value: Start at) and the page size in another, one request per page.",
    params: [
      { key: "param", label: "Page parameter", kind: "string", required: true, help: "Query parameter that carries the page number.", placeholder: "page" },
      { key: "startAt", label: "Start at", kind: "int", required: false, min: 0, help: "First page number (0 or 1 based).", placeholder: "1" },
      { key: "sizeParam", label: "Page size parameter", kind: "string", required: false, help: "Query parameter that carries the page size.", volume: true, placeholder: "limit" },
      { key: "pageSize", label: "Page size", kind: "int", required: false, min: 1, help: "Items requested per page. Larger pages mean fewer requests.", volume: true, placeholder: "50" },
    ],
  },
];

export const paginationType = (value: string) => PAGINATION_TYPES.find((t) => t.value === value);

/** Values seen in the reference document. Other values are allowed but flagged. */
export const KNOWN_VALUES = {
  authType: ["bearer"],
  method: ["GET"],
  incrementalFormat: ["iso8601"],
  unknownStatus: ["fail"],
  slaMode: ["full"],
  creationActorType: ["first_comment_author"],
} as const;

export interface MapFieldDef {
  key: string;
  label: string;
  required: boolean;
  help: string;
  placeholder: string;
}

const f = (key: string, label: string, required: boolean, help: string, placeholder: string): MapFieldDef => ({ key, label, required, help, placeholder });

export const TICKET_MAPPING: MapFieldDef[] = [
  f("id", "id", true, "Unique ticket identifier.", "$.id"),
  f("createdAt", "createdAt", true, "When the ticket was created.", "$.created_at"),
  f("status", "status", true, "Raw status, translated through the status value map.", "$.status"),
  f("title", "title", true, "Ticket subject.", "$.title"),
  f("priority", "priority", false, "Raw priority, translated through the priority value map.", "$.priority"),
  f("updatedAt", "updatedAt", false, "Last update time; used by incremental sync.", "$.updated_at"),
  f("customerId", "customerId", false, "Customer identifier.", "$.customer.id"),
  f("customerName", "customerName", false, "Customer display name.", "$.customer.name"),
  f("closedAt", "closedAt", false, "When the ticket was resolved/closed (needed for resolution SLAs).", "$.resolved_at"),
  f("tags", "tags", false, "Array of tags.", "$.tags"),
  f("channel", "channel", false, "Origin channel (email, web, …).", "$.channel"),
];

export const COMMENT_MAPPING: MapFieldDef[] = [
  f("id", "id", true, "Unique comment identifier.", "$.id"),
  f("createdAt", "createdAt", true, "When the comment was written.", "$.created_at"),
  f("authorRole", "authorRole", true, "Author role, translated through the authorRole value map.", "$.author.role"),
  f("isPublic", "isPublic", false, "Public reply (true) vs internal note (false).", "$.public"),
  f("body", "body", true, "Comment text.", "$.body"),
  f("authorName", "authorName", false, "Author display name.", "$.author.name"),
];

export const HISTORY_MAPPING: MapFieldDef[] = [
  f("id", "id", true, "Unique transition identifier.", "$.id"),
  f("changedAt", "changedAt", true, "When the status changed.", "$.created_at"),
  f("toStatus", "toStatus", true, "New status.", "$.to"),
  f("fromStatus", "fromStatus", false, "Previous status.", "$.from"),
];

export const VALUE_MAPS = [
  { key: "status", label: "Status", help: "Provider status → Elapsed status." },
  { key: "priority", label: "Priority", help: "Provider priority → Elapsed priority." },
  { key: "authorRole", label: "Author role", help: "Provider role → Elapsed role (customer / agent / system)." },
] as const;

export type ValueMapKey = (typeof VALUE_MAPS)[number]["key"];

/** Keys the builder controls, per object path. Anything else on import is preserved as an "extra". */
export const SECTION_PATHS = [
  "",
  "connection",
  "auth",
  "tickets",
  "tickets.request",
  "tickets.pagination",
  "tickets.incremental",
  "tickets.request.query",
  "comments",
  "comments.request",
  "comments.pagination",
  "comments.request.query",
  "statusHistory",
  "statusHistory.request",
  "statusHistory.pagination",
  "statusHistory.request.query",
  "statusHistory.mapping",
  "mapping",
  "commentMapping",
  "valueMaps",
  "valueMaps.status",
  "valueMaps.priority",
  "valueMaps.authorRole",
  "creationActor",
] as const;
