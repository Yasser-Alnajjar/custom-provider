import fs from "node:fs";
import path from "node:path";
import { DB_FILE, SUPABASE_KEY, SUPABASE_TABLE, SUPABASE_URL } from "./config";
import { ConflictError, StorageError } from "./errors";
import type { DbState } from "@/lib/types";

const ROW_ID = "main";

const emptyDb = (): DbState => ({ evtSeq: 0, nextNum: 1001, tickets: [], events: [] });

interface Row {
  data: DbState;
  rev: number;
}

export interface Snapshot {
  state: DbState;
  /** Revision the snapshot was loaded at (Supabase only). */
  rev: number;
}

async function supabase<T>(query: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}${query}`, {
      method: init.method,
      body: init.body,
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      cache: "no-store",
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    throw new StorageError(`Supabase: ${err.cause?.code || err.message}`);
  }

  const data = (await res.json().catch(() => null)) as T | { message?: string } | null;

  if (!res.ok) {
    throw new StorageError(`Supabase: ${(data as { message?: string } | null)?.message || `HTTP ${res.status}`}`);
  }

  return data as T;
}

function validate(state: DbState): DbState {
  if (!state || !Array.isArray(state.tickets) || !Array.isArray(state.events)) {
    throw new Error(`${dbName()} is not a valid database`);
  }

  return state;
}

export async function loadDb(): Promise<Snapshot> {
  if (SUPABASE_URL) {
    const [row] = await supabase<Row[]>(`?id=eq.${ROW_ID}&select=data,rev`);

    return { state: row ? validate(row.data) : emptyDb(), rev: row ? Number(row.rev) : 0 };
  }

  let raw: string | null = null;

  try {
    raw = fs.readFileSync(DB_FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  return { state: raw ? validate(JSON.parse(raw)) : emptyDb(), rev: 0 };
}

export async function saveDb({ state, rev }: Snapshot): Promise<void> {
  if (SUPABASE_URL) {
    // Compare-and-set on the revision: the write only lands if no other instance
    // saved since we loaded. A missing row (rev 0) is created, ignoring a race.
    const saved =
      rev === 0
        ? await supabase<Row[]>("", {
            method: "POST",
            prefer: "resolution=ignore-duplicates,return=representation",
            body: JSON.stringify({ id: ROW_ID, data: state, rev: 1 }),
          })
        : await supabase<Row[]>(`?id=eq.${ROW_ID}&rev=eq.${rev}`, {
            method: "PATCH",
            prefer: "return=representation",
            body: JSON.stringify({ data: state, rev: rev + 1 }),
          });

    if (!saved.length) throw new ConflictError("Supabase: the database changed during the request");
    return;
  }

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

export const dbName = () => (SUPABASE_URL ? `Supabase table ${SUPABASE_TABLE}` : DB_FILE);

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
