export const STATUSES = ["new", "open", "pending", "in_progress", "solved", "closed"] as const;
export const RESOLVED_STATUSES: readonly string[] = ["solved", "closed"];
export const OPEN_STATUSES: readonly string[] = ["open", "in_progress"];
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const ROLES = ["customer", "agent", "system"] as const;
export const CHANNELS = ["email", "chat", "web"] as const;

export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Role = (typeof ROLES)[number];
export type EventType = "created" | "comment" | "status_changed";

export interface Person {
  id?: string | null;
  name?: string | null;
  email?: string | null;
}

export interface Author {
  id: string | null;
  name: string | null;
  role: Role;
}

export interface Ticket {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  requester: Person | null;
  customer: Person | null;
  assignee: Person | null;
  tags: string[];
  channel: string | null;
  url: string | null;
}

export interface TicketEvent {
  id: string;
  ticket_id: string;
  type: EventType;
  created_at: string;
  author?: Partial<Author> | null;
  public: boolean;
  body: string;
  from?: string;
  to?: string;
}

/** The persisted database document (same shape in Redis and in the JSON file). */
export type PersonKind = "customers" | "requesters" | "agents";

/** People created directly through the API; tickets can also introduce people implicitly. */
export type PeopleRegistry = Record<PersonKind, Person[]>;

export interface PersonRecord {
  key: string;
  id: string | null;
  name: string;
  email: string | null;
  /** Tickets that reference this person (as customer, requester or assignee). */
  tickets: number;
  /** Events this person authored (agents) or wrote as the requester. */
  events: number;
  /** True when the person was created directly rather than introduced by a ticket. */
  registered: boolean;
}

export type GenerationStatus = "running" | "cancelled" | "completed" | "failed";

/** A synthetic-ticket generation job. Persisted in the database so it survives restarts and can be resumed. */
export interface GenerationJob {
  id: string;
  /** Sequence number; part of every generated ticket id (`SYN-<seq>-<n>`). */
  seq: number;
  idempotency_key: string;
  status: GenerationStatus;
  requested: number;
  batch_size: number;
  /** Deterministic inputs: the same job always generates the same tickets. */
  seed: number;
  anchor: number;
  /** Next ticket index (0-based) to generate; everything below it is done. */
  cursor: number;
  generated: number;
  failed: number;
  batches: number;
  /** Failed attempts at the current batch (reset on success). */
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface GenerationProgress extends GenerationJob {
  /** Synthetic tickets of this job actually present in the database. */
  processed: number;
  remaining: number;
}

export interface DbState {
  evtSeq: number;
  nextNum: number;
  tickets: Ticket[];
  events: TicketEvent[];
  /** Optional so databases written before people had endpoints still load. */
  people?: PeopleRegistry;
  /** Synthetic data generation jobs (most recent last). */
  generation?: { seq: number; jobs: GenerationJob[] };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  next_page: number | null;
}
