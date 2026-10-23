import fs from "node:fs";
import path from "node:path";
import { DB_FILE, REDIS_KEY, REDIS_TOKEN, REDIS_URL } from "./config";
import { ConflictError, StorageError } from "./errors";
import type { DbState } from "@/lib/types";

const REV_KEY = `${REDIS_KEY}:rev`;

// Saves only if the revision is still the one we loaded, then bumps it.
const SAVE_SCRIPT = `
if (redis.call("GET", KEYS[2]) or "0") ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
return redis.call("INCR", KEYS[2])`;

const emptyDb = (): DbState => ({ evtSeq: 0, nextNum: 1001, tickets: [], events: [] });

async function redis<T>(command: unknown[]): Promise<T> {
  let res: Response;

  try {
    res = await fetch(REDIS_URL!, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      body: JSON.stringify(command),
      cache: "no-store",
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    throw new StorageError(`Redis: ${err.cause?.code || err.message}`);
  }

  const data = (await res.json().catch(() => null)) as { result?: T; error?: string } | null;

  if (!res.ok || !data || data.error) {
    throw new StorageError(`Redis: ${data?.error || `HTTP ${res.status}`}`);
  }

  return data.result as T;
}

export interface Snapshot {
  state: DbState;
  /** Revision the snapshot was loaded at (Redis only). */
  rev: string;
}

export async function loadDb(): Promise<Snapshot> {
  let raw: string | null = null;
  let rev = "0";

  if (REDIS_URL) {
    const [value, r] = await redis<[string | null, string | null]>(["MGET", REDIS_KEY, REV_KEY]);

    raw = value;
    rev = r || "0";
  } else {
    try {
      raw = fs.readFileSync(DB_FILE, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  const state: DbState = raw ? JSON.parse(raw) : emptyDb();

  if (!Array.isArray(state.tickets) || !Array.isArray(state.events)) {
    throw new Error(`${dbName()} is not a valid database`);
  }

  return { state, rev };
}

export async function saveDb({ state, rev }: Snapshot): Promise<void> {
  const raw = JSON.stringify(state, null, 2);

  if (REDIS_URL) {
    const next = await redis<number>(["EVAL", SAVE_SCRIPT, "2", REDIS_KEY, REV_KEY, rev, raw]);

    if (!next) throw new ConflictError("Redis: the database changed during the request");
    return;
  }

  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

  // Write to a temp file and rename so a crash never leaves a half-written db.
  const tmp = `${DB_FILE}.tmp`;

  fs.writeFileSync(tmp, raw);
  fs.renameSync(tmp, DB_FILE);
}

export const dbName = () => (REDIS_URL ? `Redis key ${REDIS_KEY}` : DB_FILE);

// Requests run one at a time per process, so a request never loads the database
// while another is between changing the state and saving it.
const globalQueue = globalThis as unknown as { __acmeQueue?: Promise<unknown> };
globalQueue.__acmeQueue ??= Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = (globalQueue.__acmeQueue as Promise<unknown>).then(fn);

  globalQueue.__acmeQueue = run.catch(() => {});
  return run;
}

const MAX_ATTEMPTS = 5;

/**
 * Runs `fn` against a freshly loaded database. When `fn` returns, the state is
 * saved if `write` is true. A save conflict reloads and runs `fn` again, so
 * `fn` must not have side effects outside the state it is given.
 */
export function withDb<T>(write: boolean, fn: (state: DbState) => T): Promise<T> {
  return serialized(async () => {
    for (let attempt = 1; ; attempt++) {
      const snapshot = await loadDb();

      try {
        const result = fn(snapshot.state);

        if (write) await saveDb(snapshot);
        return result;
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt === MAX_ATTEMPTS) throw e;
      }
    }
  });
}
