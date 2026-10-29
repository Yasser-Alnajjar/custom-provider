import { generatorLimits } from "./config";
import { withDb } from "./db";
import { conflict, HttpError, notFound, validationError } from "./errors";
import { addEvent, validateTicketBody } from "./tickets";
import { ticketIdPrefix, isSyntheticTicket, planTicket } from "@/lib/generator";
import type { DbState, GenerationJob, GenerationProgress } from "@/lib/types";

const KEEP_JOBS = 20;
const MAX_ATTEMPTS = 3;
const KEY = /^[A-Za-z0-9_.:-]{8,100}$/;

const state_ = (state: DbState) => (state.generation ??= { seq: 0, jobs: [] });

export function assertEnabled() {
  if (!generatorLimits().enabled) {
    throw new HttpError(403, "disabled", "The synthetic data generator is disabled (GENERATOR_ENABLED=0).");
  }
}

/** Validates the requested count: an integer from 1 to the configured maximum. */
export function parseCount(value: unknown): number {
  const { maxTickets } = generatorLimits();

  if (typeof value !== "number" || !Number.isInteger(value)) throw validationError("count must be a whole number");
  if (value < 1 || value > maxTickets) throw validationError(`count must be between 1 and ${maxTickets}`);
  return value;
}

const countOf = (state: DbState, seq: number) => {
  const prefix = ticketIdPrefix(seq);

  return state.tickets.reduce((n, t) => (t.id.startsWith(prefix) ? n + 1 : n), 0);
};

export function progress(state: DbState, job: GenerationJob): GenerationProgress {
  return { ...job, processed: countOf(state, job.seq), remaining: Math.max(0, job.requested - job.cursor) };
}

function findJob(state: DbState, id: string): GenerationJob {
  const job = state_(state).jobs.find((j) => j.id === id);

  if (!job) throw notFound("Generation job not found");
  return job;
}

export function listJobs(state: DbState) {
  const jobs = state_(state).jobs;

  return {
    items: [...jobs].reverse().map((j) => progress(state, j)),
    total: jobs.length,
    limits: generatorLimits(),
    synthetic_tickets: state.tickets.filter(isSyntheticTicket).length,
  };
}

export const getJob = (state: DbState, id: string) => progress(state, findJob(state, id));

/**
 * Creates a job, or returns the existing one for the same idempotency key
 * (`reused: true`). Only one job may run at a time, which also protects the
 * database from competing generations.
 */
export function createJob(state: DbState, body: Record<string, unknown>) {
  assertEnabled();

  const count = parseCount(body.count);
  const key = body.idempotency_key;

  if (typeof key !== "string" || !KEY.test(key)) {
    throw validationError("idempotency_key must be 8-100 characters (letters, digits, _ . : -)");
  }

  const gen = state_(state);
  const existing = gen.jobs.find((j) => j.idempotency_key === key);

  if (existing) {
    if (existing.requested !== count) throw conflict("idempotency_key was already used with a different count");
    return { job: progress(state, existing), reused: true };
  }

  const running = gen.jobs.find((j) => j.status === "running");

  if (running) throw conflict(`Job ${running.id} is still running; wait for it or cancel it first`);

  const { maxTotal, batchSize } = generatorLimits();
  const present = state.tickets.filter(isSyntheticTicket).length;

  if (present + count > maxTotal) {
    throw validationError(`This would exceed the limit of ${maxTotal} synthetic tickets (${present} exist). Delete some first.`);
  }

  const seq = ++gen.seq;
  const now = Date.now();
  const job: GenerationJob = {
    id: `gen-${seq}`,
    seq,
    idempotency_key: key,
    status: "running",
    requested: count,
    batch_size: batchSize,
    seed: Math.floor(Math.random() * 2 ** 31),
    anchor: now,
    cursor: 0,
    generated: 0,
    failed: 0,
    batches: 0,
    attempts: 0,
    error: null,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    finished_at: null,
  };

  gen.jobs.push(job);
  if (gen.jobs.length > KEEP_JOBS) gen.jobs.splice(0, gen.jobs.length - KEEP_JOBS);
  return { job: progress(state, job), reused: false };
}

/**
 * Writes the next bounded batch. Everything (tickets, events, the cursor) is part
 * of the one state that gets saved, so a batch either lands completely or not at
 * all, and ticket ids are deterministic, so a repeated batch is a no-op.
 */
export function advanceJob(state: DbState, id: string, now = Date.now()) {
  assertEnabled();

  const job = findJob(state, id);

  if (job.status !== "running") return progress(state, job);

  const end = Math.min(job.cursor + job.batch_size, job.requested);
  const have = new Set<string>();
  const prefix = ticketIdPrefix(job.seq);

  for (const t of state.tickets) if (t.id.startsWith(prefix)) have.add(t.id);

  for (let index = job.cursor; index < end; index++) {
    const plan = planTicket({ seq: job.seq, seed: job.seed, anchor: job.anchor, index });

    if (have.has(plan.ticket.id)) {
      job.generated++; // written by an earlier attempt whose cursor was not saved
      continue;
    }

    try {
      validateTicketBody(plan.ticket as unknown as Record<string, unknown>);
    } catch {
      job.failed++;
      continue;
    }

    // The history is back-dated, but the ticket was changed now. Elapsed lists tickets with
    // `updated_since=<last pass>`, so a stale updated_at would hide it from every later sync.
    plan.ticket.updated_at = new Date(now).toISOString();
    state.tickets.push(plan.ticket);
    for (const e of plan.events) {
      addEvent(state, plan.ticket.id, e.type, e.at, { author: e.author, public: e.public, body: e.body, from: e.from, to: e.to });
    }

    job.generated++;
  }

  job.cursor = end;
  job.batches++;
  job.attempts = 0;
  job.error = null;
  job.updated_at = new Date(now).toISOString();

  if (job.cursor >= job.requested) {
    job.status = job.failed ? "failed" : "completed";
    job.finished_at = job.updated_at;
    if (job.failed) job.error = `${job.failed} ticket(s) failed validation`;
  }

  return progress(state, job);
}

/** Records a failed attempt (called in its own save after the batch threw). */
export function recordFailure(state: DbState, id: string, message: string) {
  const job = findJob(state, id);

  job.attempts++;
  job.error = message.slice(0, 300);
  job.updated_at = new Date().toISOString();

  if (job.attempts >= MAX_ATTEMPTS) {
    job.status = "failed";
    job.finished_at = job.updated_at;
  }

  return progress(state, job);
}

export function cancelJob(state: DbState, id: string) {
  const job = findJob(state, id);

  if (job.status === "running") {
    job.status = "cancelled";
    job.finished_at = job.updated_at = new Date().toISOString();
  }

  return progress(state, job);
}

/** Resumes a cancelled or failed job from its cursor; completed jobs cannot be resumed. */
export function resumeJob(state: DbState, id: string) {
  assertEnabled();

  const job = findJob(state, id);

  if (job.status === "completed") throw conflict("Job already completed");
  if (job.status === "running") return progress(state, job);

  const running = state_(state).jobs.find((j) => j.status === "running");

  if (running) throw conflict(`Job ${running.id} is still running`);
  if (job.failed) throw conflict("Job has tickets that failed validation and cannot be resumed");

  job.status = "running";
  job.attempts = 0;
  job.error = null;
  job.finished_at = null;
  job.updated_at = new Date().toISOString();
  return progress(state, job);
}

/** Removes only synthetic tickets (and their events); real tickets are never touched. */
export function purgeSynthetic(state: DbState) {
  const gen = state_(state);

  if (gen.jobs.some((j) => j.status === "running")) throw conflict("A job is running; cancel it first");

  const ids = new Set(state.tickets.filter(isSyntheticTicket).map((t) => t.id));

  state.tickets = state.tickets.filter((t) => !ids.has(t.id));
  state.events = state.events.filter((e) => !ids.has(e.ticket_id));
  return { deleted: ids.size };
}

/**
 * One batch in its own database save. If it throws, the save never happened (the
 * state is unchanged), so the failure is recorded separately and the batch can be
 * retried; after MAX_ATTEMPTS the job is marked failed and can be resumed.
 */
export async function runBatch(id: string) {
  try {
    return await withDb(true, (state) => advanceJob(state, id));
  } catch (e) {
    if (e instanceof HttpError) throw e;

    await withDb(true, (state) => recordFailure(state, id, e instanceof Error ? e.message : String(e))).catch(() => {});
    throw e;
  }
}

/**
 * Marks every synthetic ticket as changed now, so Elapsed's incremental sync
 * (`updated_since`) lists them again. For tickets generated before generated
 * tickets were stamped at write time. Real tickets and history are untouched.
 */
export function touchSynthetic(state: DbState, now = Date.now()) {
  if (state_(state).jobs.some((j) => j.status === "running")) throw conflict("A job is running; cancel it first");

  const stamp = new Date(now).toISOString();
  let touched = 0;

  for (const t of state.tickets) {
    if (isSyntheticTicket(t)) {
      t.updated_at = stamp;
      touched++;
    }
  }

  return { touched };
}
