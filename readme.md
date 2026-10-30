# Custom Ticket Provider Lab

A small mock ticketing provider for testing Elapsed's Custom Ticket Provider integration. It is **not** a production ticketing system and does not modify the Elapsed repository.

It stores tickets with their history: customer and agent comments, internal notes, status transitions with timestamps, closure times, tags and channels. It starts with no tickets; create them from the UI or the API. Data is saved in Supabase when it is configured (see [Deploy to Vercel](#deploy-to-vercel)), otherwise in a JSON file database, `public/db.json` (set `DB_FILE` to change it). Files in `public/` are served as static files, so the file database is readable without the API token at `/db.json` while the file exists. If the database does not exist it is created empty; delete it and restart to reset.

## Requirements

- Node.js 20.9+ (Next.js 16)
- `npm install`

## Run locally

```bash
npm install
npm run dev          # development, http://localhost:4100
npm run build && npm start   # production build
```

Open http://localhost:4100 for the lab UI. Set `PORT` and `API_TOKEN` to change the port (default `4100`) or the bearer token (default `demo_elapsed`).

Other scripts: `npm run lint`, `npm run typecheck`, `npm test`.

## Ticket lifecycle

Tickets support create (`POST /api/tickets`), read (`GET /api/tickets`, `GET /api/tickets/:id`), update (`PATCH /api/tickets/:id`) and delete (`DELETE /api/tickets/:id`, which also removes that ticket's events; ids are never reused). Comments, internal notes and status history are append-only on purpose: they are the audit trail Elapsed uses for first-response and resolution timings, so they cannot be edited or deleted on their own. Customers, requesters and agents have their own CRUD endpoints (`/api/customers`, `/api/requesters`, `/api/agents`, with `GET`/`POST` on the collection and `GET`/`PATCH`/`DELETE` on `/:key`, where the key is the customer id or name, the requester email, or the agent id). They are the union of people that tickets mention and people created directly (stored under `people` in the database, optional for older files). Renaming a person rewrites the embedded copies on tickets (bumping `updated_at` so Elapsed's sync sees it) and the author name on their events. A person that tickets or event history refer to cannot be deleted (`409 conflict`); `id` cannot be changed; duplicate keys are rejected with `409`. Elapsed syncs with `updated_since`, which cannot report deletions, so a deleted ticket simply stops appearing.

## Architecture

The app is a single Next.js (App Router) project. There is no separate server.

| Path | Role |
| --- | --- |
| `app/api/**`, `app/health`, `app/elapsed-config.json` | Route Handlers: the REST API Elapsed consumes (same routes, status codes, messages and CORS as before) |
| `lib/server/` | Server only: `db.ts` (Supabase or JSON file, revision-checked saves), `tickets.ts` (business rules and validation), `http.ts` (auth, JSON, errors), `elapsed-config.ts` |
| `lib/` | Shared pure logic: types, formatting, the derived customers / requesters / agents directory, filters, payload builders (unit-tested) |
| `app/**/page.tsx` | Server Components: routing and metadata. They render the client views |
| `components/desk/` | The lab UI. Views are Client Components because the API token lives in the browser and the UI calls the same public API as Elapsed |
| `components/ui/` | shadcn/ui primitives (Tailwind CSS v4) |

## Synthetic data generator

`/generator` (sidebar: Data generator) creates synthetic tickets through the normal data model, so Elapsed syncs them like any other ticket. Tickets have ids `SYN-<job>-<n>`, the tags `synthetic` and `synthetic-job-<job>`, a `[SYNTHETIC]` title prefix and `@synthetic.invalid` requesters, and carry a full history (created, customer comment, status transitions, public agent replies, internal notes) with consistent timestamps in the last 10 to 60 days.

Generation runs as a persisted job (stored in the database under `generation`), written in bounded batches: `POST /api/generator/jobs {count, idempotency_key}` creates it, `POST /api/generator/jobs/:id/advance` writes one batch, `…/cancel` and `…/resume` stop and continue it, `GET /api/generator/jobs[/:id]` reports `generated`, `processed`, `failed` and `remaining`, and `DELETE /api/generator/synthetic` removes synthetic tickets only. The page drives `advance` in a loop; a reload picks a running job up again. There is no background worker in this app, so a job only progresses while a client calls `advance`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GENERATOR_MAX_TICKETS` | `1000` (max 5000) | Largest single request |
| `GENERATOR_BATCH_SIZE` | `50` (max 200) | Tickets per batch / database save |
| `GENERATOR_MAX_TOTAL` | `5000` (max 20000) | Synthetic tickets allowed at once |
| `GENERATOR_ENABLED` | on | `0` disables the generator |

## Deploy to Vercel

Import the repo in Vercel. The framework is detected as Next.js and no `vercel.json` is needed. Set `API_TOKEN` in the project's environment variables to change the token. (The old `vercel.json` rewrites and `api/index.js` entry are gone: Next.js routes everything itself.)

Vercel serves the app over HTTPS on a public host, so Elapsed can use `https://<your-app>.vercel.app/elapsed-config.json` without `CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS`.

**Add Supabase for storage.** A serverless function has no disk that lasts, and each instance has its own memory, so without a shared database a ticket created on one instance is missing on the others ("Ticket … does not exist on the server"). To fix it:

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor. It creates the `acmedesk_db` table.
2. In the Vercel project's environment variables set `SUPABASE_URL` (the project URL, `https://<ref>.supabase.co`) and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API). Keep the service role key server-side only; the table has row level security on and no policies, so the public anon key cannot read it.
3. Redeploy.

The whole database is one JSON document in the row `id = 'main'` (set `SUPABASE_TABLE` to use another table). Every API request reads it, and every change writes it back, so all instances see the same tickets. A save only succeeds if no other instance saved since the request read the data (the `rev` column); otherwise the request runs again on the newer data, so concurrent changes are not lost. To reset the data, delete the row (`delete from acmedesk_db;`). Because it is one document, keep totals modest.

Without Supabase the server falls back to `/tmp/db.json` on Vercel, which is per instance and wiped on cold starts. Use that only for short demos where losing data is fine.

## Deploy for reliable storage (VPS)

For data that persists, run the app as one long-lived Node.js process on a machine with a writable disk, such as a VPS:

```bash
git clone <repo> && cd custom-provider
npm ci && npm run build
API_TOKEN=<your-token> PORT=4100 npm start
```

Keep it running with a process manager (for example systemd or `pm2 start npm --name acmedesk -- start`), and put it behind a reverse proxy with HTTPS (for example Caddy or nginx) so Elapsed can reach it. Data is kept in `public/db.json` under the working directory. Back up that file, or set `DB_FILE` to a path on a persistent volume. Run a single process only: two processes writing the same file would overwrite each other's changes. (To share data between processes, use Supabase instead.)

## Migrating from the previous version

The previous version was a dependency-free Node server plus a vanilla-JS UI. What changed:

- **Unchanged:** every API route, request/response shape, status code, error message, the bearer / `X-Api-Key` auth, CORS headers, `/health`, `/elapsed-config.json`, the JSON file format, and the environment variables (`PORT`, `API_TOKEN`, `DB_FILE`). Existing databases are read as they are.
- **Removed:** Redis storage (`REDIS_KEY`, `UPSTASH_REDIS_REST_*`, `KV_REST_API_*`), replaced by Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_TABLE`). The default file database location moved from `data/db.json` to `public/db.json`.
- **Changed:** you now need `npm install` and a build (`npm run build`) before `npm start`; `node server.js` no longer exists. Node 20.9+ is required. `vercel.json` and `api/index.js` were removed. The UI is rebuilt in React with the same routes and features; it keeps the token and acting-as identity in `localStorage` under the same keys.

## The lab UI

The UI is a React app (Next.js App Router) served by the same server, so it always talks to the same origin and port. Routes survive a refresh; filters, sort and page live in the query string.

| Route | What it shows |
| --- | --- |
| `/` | Stats, recently updated tickets, status breakdown, latest activity |
| `/tickets` | All tickets: search, status / priority / assignee / customer / channel / tag filters, sorting, pagination, create |
| `/tickets/:id` | Ticket overview, **conversation** (public replies vs internal notes), reply / note composer, **activity log** and **status history**, properties (status, priority, assignee), people, timeline metrics, related tickets, edit |
| `/activity` | Every event from `GET /api/events`, filterable by type, visibility and author role |
| `/customers`, `/customers/:key` | Customers with their requesters, tickets and activity |
| `/requesters`, `/requesters/:key` | Requesters with their tickets and comments |
| `/agents`, `/agents/:id` | Assignees and agent authors with workload, replies, notes, status changes |
| `/provider` | Base URL, API token, live `/health` and `/api/meta`, "acting as" identity, endpoint reference, Elapsed config |

Customers, requesters and agents have no endpoints of their own: those pages are derived from the `customer`, `requester` and `assignee` objects on tickets and from event authors.

The API token the UI sends is kept in the browser (`localStorage`); change it on **Provider** if you start the server with a different `API_TOKEN`. Comments written from the UI are posted as the identity chosen under **Provider → Acting as**.

### Styling

Tailwind CSS v4 with shadcn/ui primitives (`components/ui`). Theme tokens live in `app/globals.css`; the UI is dark only.

## Use it in Elapsed

1. In Elapsed's `.env`, set `CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS=1` (without it Elapsed only accepts public HTTPS hosts) and restart the web app and worker.
2. Make sure the organization has the Custom REST beta flag on.
3. Go to **Settings → Integrations → Custom REST**, open the **Advanced (JSON)** step, paste the output of http://127.0.0.1:4100/elapsed-config.json, and apply it.
4. In the **Connection** step, enter the bearer token (`demo_elapsed`). Secrets are never part of the JSON.
5. Run **Test**, **Sample** and **Preview** on the **Review** step, then activate.

Use `127.0.0.1`, not `localhost`: Node may resolve `localhost` to IPv6 while this server listens on IPv4. If Elapsed runs in Docker, replace the host in `connection.baseUrl` with `host.docker.internal`.

The generated config uses Full SLA mode: page pagination with `updated_since` incremental sync, comments and status history fetched per ticket, and closure times from `resolved_at`. Elapsed's validator reports first response, next reply and resolution as supported.

## API

All `/api/*` routes need `Authorization: Bearer <API_TOKEN>` (or `X-Api-Key`).

| Route | Purpose |
| --- | --- |
| `GET /api/tickets?page=&limit=&updated_since=&status=&q=` | Paginated list: `data.items`, `data.pagination` |
| `GET /api/tickets/:id` | One ticket |
| `GET /api/tickets/:id/comments` | Comments, oldest first. `author.role` is `customer`, `agent` or `system`; `public: false` marks an internal note |
| `GET /api/tickets/:id/history` | Real status transitions (`from`, `to`, `created_at`) |
| `GET /api/events?ticket_id=&type=` | All activity: `created`, `comment`, `status_changed` |
| `POST /api/tickets` | Create a ticket (also records the opening comment) |
| `PATCH /api/tickets/:id` | Change fields. A `status` change records a history entry and sets or clears `resolved_at` |
| `POST /api/events` | Add a comment: `{ "ticket_id", "body", "author": { "name", "role" }, "public": false }` |
| `GET /elapsed-config.json` | Elapsed configuration document (no auth, no secrets) |
| `GET /health` | Liveness |

Statuses: `new`, `open`, `pending`, `in_progress`, `solved`, `closed`. Priorities: `low`, `normal`, `high`, `urgent`.

Elapsed only reads from this API. The write routes exist for the lab UI and for you to change data and watch Elapsed pick it up on the next sync, for example:

```bash
curl -X POST localhost:4100/api/events -H 'Authorization: Bearer demo_elapsed' \
  -d '{"ticket_id":"TCK-1001","body":"Looking into it","author":{"name":"Omar","role":"agent"}}'
```

Ticket IDs start at `TCK-1001`.

## Limits of this API (what the UI cannot show)

The server only exposes what is listed above. There are no endpoints or fields for users, customers or groups as resources, attachments, custom fields, ticket type, linked/merged tickets, ticket deletion, or comment editing. Other behaviour worth knowing:

- Only status changes and comments are recorded as events. Changing priority, assignee, tags or other fields is saved but does not appear in the history.
- The server has no authenticated user, so a status change is attributed to the ticket's assignee (or System) rather than to whoever made it.
- `GET /api/tickets` returns tickets sorted by ID; the UI loads every page and sorts/filters client-side. `/comments`, `/history` and `/api/events` are not paginated.
