import fs from "node:fs";
import path from "node:path";
import { DB_FILE } from "./config";
import { StorageError } from "./errors";
import type { DbState } from "@/lib/types";

const emptyDb = (): DbState => ({ evtSeq: 0, nextNum: 1001, tickets: [], events: [] });

export function loadDb(): DbState {
  let raw: string | null = null;

  try {
    raw = fs.readFileSync(DB_FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const state: DbState = raw ? JSON.parse(raw) : emptyDb();

  if (!Array.isArray(state.tickets) || !Array.isArray(state.events)) {
    throw new Error(`${DB_FILE} is not a valid database`);
  }

  return state;
}

export function saveDb(state: DbState): void {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

    // Write to a temp file and rename so a crash never leaves a half-written db.
    const tmp = `${DB_FILE}.tmp`;

    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    throw new StorageError(`Cannot write ${DB_FILE}: ${(e as Error).message}`);
  }
}

// Requests run one at a time per process, so a request never loads the database
// while another is between changing the state and saving it.
const globalQueue = globalThis as unknown as { __acmeQueue?: Promise<unknown> };
globalQueue.__acmeQueue ??= Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = (globalQueue.__acmeQueue as Promise<unknown>).then(fn);

  globalQueue.__acmeQueue = run.catch(() => {});
  return run;
}

/**
 * Runs `fn` against a freshly loaded database. When `fn` returns, the state is
 * saved if `write` is true.
 */
export function withDb<T>(write: boolean, fn: (state: DbState) => T): Promise<T> {
  return serialized(async () => {
    const state = loadDb();
    const result = fn(state);

    if (write) saveDb(state);
    return result;
  });
}
