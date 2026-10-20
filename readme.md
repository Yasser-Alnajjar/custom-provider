# Custom Ticket Provider Lab

A tiny, dependency-free mock ticketing provider for testing Elapsed's Custom Ticket Provider integration. It is **not** a production ticketing system and does not modify the Elapsed repository.

It serves 36 tickets with realistic history: customer and agent comments, internal notes, status transitions with timestamps, closure times, tags and channels. All timestamps are generated relative to when the server starts, so the data always sits inside Elapsed's import window. Data lives in memory; restart to reset.

## Requirements

- Node.js 18+
- No npm install required

## Run locally

```bash
node server.js
```

Open http://localhost:4100 for the lab UI. Set `PORT` and `API_TOKEN` to change the port (default `4100`) or the bearer token (default `demo_elapsed_token`).

## Deploy to Vercel

Import the repo in Vercel (framework preset **Other**, no build settings needed) or run `npx vercel`. `public/` is served as static files and `api/index.js` runs `server.js` as a serverless function; `vercel.json` routes `/api/*`, `/health` and `/elapsed-config.json` to it and falls back to the app shell for UI routes. Set `API_TOKEN` in the project's environment variables to change the token.

Vercel serves the app over HTTPS on a public host, so Elapsed can use `https://<your-app>.vercel.app/elapsed-config.json` without `CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS`.

Data is still in memory: each new function instance starts from the seed data, so changes made through the UI or API can disappear after a cold start or differ between instances.

## The lab UI

The UI is a small client-side app (vanilla ES modules, no framework) served by the same server, so it always talks to the same origin and port. Routes survive a refresh; filters, sort and page live in the query string.

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

Styles are built with Tailwind CSS v4. The server and UI have no runtime dependencies; Tailwind is only needed to regenerate `public/styles.css` from `src/styles.css` after you change styles or add classes:

```bash
npm install          # first time only (dev dependencies)
npm run build:css    # or: npm run watch:css
```

`public/styles.css` is committed, so running the lab still needs only Node.

## Use it in Elapsed

1. In Elapsed's `.env`, set `CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS=1` (without it Elapsed only accepts public HTTPS hosts) and restart the web app and worker.
2. Make sure the organization has the Custom REST beta flag on.
3. Go to **Settings → Integrations → Custom REST**, open the **Advanced (JSON)** step, paste the output of http://127.0.0.1:4100/elapsed-config.json, and apply it.
4. In the **Connection** step, enter the bearer token (`demo_elapsed_token`). Secrets are never part of the JSON.
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
curl -X POST localhost:4100/api/events -H 'Authorization: Bearer demo_elapsed_token' \
  -d '{"ticket_id":"TCK-1004","body":"Looking into it","author":{"name":"Omar","role":"agent"}}'
```

`TCK-1004` is urgent and unanswered, so it starts with a live first-response clock.

## Limits of this API (what the UI cannot show)

The server only exposes what is listed above. There are no endpoints or fields for users, customers or groups as resources, attachments, custom fields, ticket type, linked/merged tickets, ticket deletion, or comment editing. Other behaviour worth knowing:

- Only status changes and comments are recorded as events. Changing priority, assignee, tags or other fields is saved but does not appear in the history.
- The server has no authenticated user, so a status change is attributed to the ticket's assignee (or System) rather than to whoever made it.
- `GET /api/tickets` returns tickets sorted by ID; the UI loads every page and sorts/filters client-side. `/comments`, `/history` and `/api/events` are not paginated.
- Static routes without a file extension (`/tickets/TCK-1001`) fall back to the app shell so refresh and deep links work.
