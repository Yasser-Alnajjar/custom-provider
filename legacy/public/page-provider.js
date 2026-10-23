// Provider: connection details, auth token, server health/capabilities,
// the "acting as" identity, the endpoint reference and the Elapsed config.

import {
  getToken, setToken, DEFAULT_TOKEN, getMeta, getHealth, getElapsedConfig, getActor, setActor,
} from "./api.js";
import { $, esc, pageHead, copyText, toast, humanize, plural } from "./lib.js";
import { store, ensureCore, directory } from "./store.js";

const ENDPOINTS = [
  ["GET", "/api/tickets?page=&limit=&updated_since=&status=&q=", "Paginated ticket list", "Tickets"],
  ["GET", "/api/tickets/:id", "One ticket", "Ticket page"],
  ["GET", "/api/tickets/:id/comments", "Comments and internal notes, oldest first", "Ticket → Conversation"],
  ["GET", "/api/tickets/:id/history", "Status transitions", "Ticket → Status history"],
  ["GET", "/api/events?ticket_id=&type=", "All activity: created, comment, status_changed", "Activity, Ticket → Activity"],
  ["POST", "/api/tickets", "Create a ticket", "Create ticket"],
  ["PATCH", "/api/tickets/:id", "Edit fields / change status", "Edit ticket, Properties"],
  ["POST", "/api/events", "Add a comment or internal note", "Ticket → Composer"],
  ["GET", "/api/meta", "Provider capabilities", "This page"],
  ["GET", "/health", "Liveness (no auth)", "This page"],
  ["GET", "/elapsed-config.json", "Elapsed configuration (no auth)", "This page"],
];

export async function providerPage(ctx) {
  ctx.title("Provider");
  const origin = location.origin;
  ctx.view.innerHTML = `${pageHead({
    title: "Provider",
    subtitle: "Connection details for Elapsed, the API token this UI uses, and live server information.",
  })}
  <section class="two-col">
    <div class="panel"><div class="panel-heading"><div><h2>Connection</h2><p>Use these values in the Elapsed setup wizard.</p></div><span class="badge">v1</span></div>
      <div class="api-list">
        <div class="api-row"><div><label>Base URL</label><code id="baseUrl">${esc(origin)}/api</code></div><button class="copy" data-copy="${esc(origin)}/api">Copy</button></div>
        <div class="api-row"><div><label>Authentication</label><code>Authorization: Bearer &lt;token&gt;</code> <span class="muted">or</span> <code>X-Api-Key</code></div></div>
        <div class="api-row"><div><label>Elapsed config document</label><code>${esc(origin.replace("localhost", "127.0.0.1"))}/elapsed-config.json</code></div><button class="copy" data-copy="${esc(origin.replace("localhost", "127.0.0.1"))}/elapsed-config.json">Copy</button></div>
      </div>
      <form id="tokenForm" class="inline-form"><label>API token used by this UI
        <div class="inline-row"><input id="tokenInput" type="password" autocomplete="off" value="${esc(getToken())}"><button type="button" class="copy" data-toggle-token>Show</button></div></label>
        <div class="inline-row"><button class="btn primary" type="submit">Save &amp; test</button><button class="btn secondary" type="button" data-reset-token>Use default</button><span id="tokenResult" class="muted"></span></div>
        <p class="hint">The server's token is set with the <code>API_TOKEN</code> environment variable (default <code>${DEFAULT_TOKEN}</code>). It is kept in this browser only.</p></form>
      <div class="callout"><span>ⓘ</span><div><b>For a remote Elapsed instance</b><p><code>localhost</code> refers to the machine running Elapsed, not your laptop. Use <code>127.0.0.1</code>, or <code>host.docker.internal</code> if Elapsed runs in Docker. Do not expose the demo publicly without restricting access.</p></div></div>
    </div>
    <div class="panel"><div class="panel-heading"><div><h2>Server</h2><p>Live responses from <code>/health</code> and <code>/api/meta</code>.</p></div><button class="text-btn" data-refresh-server>Refresh ↻</button></div>
      <div id="serverInfo" class="api-list"><div class="empty">Loading…</div></div>
    </div>
  </section>
  <section class="panel" id="identity"><div class="panel-heading"><div><h2>Acting as</h2><p>The server has no user accounts. Comments written from this UI are posted under this agent identity.</p></div></div>
    <form id="actorForm" class="inline-form"><div class="form-row"><label>Agent<select id="actorSelect"></select></label><label>Display name<input id="actorName" required></label></div>
    <div class="inline-row"><button class="btn primary" type="submit">Save identity</button><span class="muted" id="actorResult"></span></div></form>
  </section>
  <section class="panel"><div class="panel-heading"><div><h2>API endpoints</h2><p>Every route the server exposes and where this UI uses it.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>METHOD</th><th>PATH</th><th>PURPOSE</th><th>USED IN</th><th></th></tr></thead><tbody>${ENDPOINTS.map(([m, p, d, u]) => `<tr><td><span class="method m-${m}">${m}</span></td><td><code>${esc(p)}</code></td><td>${esc(d)}</td><td>${esc(u)}</td><td><button class="copy" data-copy="${esc(origin + p.split("?")[0].replace(":id", "TCK-1001"))}">Copy URL</button></td></tr>`).join("")}</tbody></table></div>
    <div class="table-footer"><span>Not provided by the server: users, customers, groups, attachments, custom fields, delete operations, pagination on comments/events.</span></div>
  </section>
  <section class="panel"><div class="panel-heading"><div><h2>Elapsed configuration</h2><p>Paste this into Elapsed's Advanced (JSON) step.</p></div><button class="copy" data-copy-config>Copy JSON</button></div>
    <pre class="code" id="configJson">Loading…</pre></section>`;

  async function loadServer() {
    const el = $("#serverInfo", ctx.view);
    const [h, m] = await Promise.allSettled([getHealth(), getMeta()]);
    if (!ctx.isCurrent()) return;
    const row = (k, v) => `<div class="api-row"><div><label>${k}</label>${v}</div></div>`;
    const err = (r) => `<span class="error-text">${esc(r.reason.message)}${r.reason.status === 401 ? " — check the API token" : ""}</span>`;
    el.innerHTML = [
      row("Health", h.status === "fulfilled" ? `<code>${h.value.ok ? "ok" : "not ok"} · ${esc(h.value.provider)} · v${esc(h.value.version)}</code>` : err(h)),
      row("API version / auth", m.status === "fulfilled" ? `<code>${esc(m.value.api_version)} · ${esc(m.value.auth)}</code>` : err(m)),
      row("Capabilities", m.status === "fulfilled" ? `<div class="chips">${m.value.capabilities.map((c) => `<span class="chip">${esc(humanize(c))}</span>`).join("")}</div>` : err(m)),
      row("Loaded in this UI", store.ticketsState === "ready" ? `<code>${plural(store.tickets.length, "ticket")} · ${plural(store.events.length, "event")}</code>` : `<span class="muted">Not loaded</span>`),
    ].join("");
  }
  async function loadConfig() {
    try {
      const cfg = await getElapsedConfig();
      if (!ctx.isCurrent()) return;
      $("#configJson", ctx.view).textContent = JSON.stringify(cfg, null, 2);
    } catch (e) {
      if (ctx.isCurrent()) $("#configJson", ctx.view).textContent = `Could not load /elapsed-config.json: ${e.message}`;
    }
  }
  function fillActor() {
    const actor = getActor();
    const agents = new Map([...directory().agents.values()].map((a) => [a.id, a.name]));
    agents.set(actor.id, actor.name);
    $("#actorSelect", ctx.view).innerHTML = [...agents].map(([id, name]) => `<option value="${esc(id)}"${id === actor.id ? " selected" : ""}>${esc(name)}</option>`).join("");
    $("#actorName", ctx.view).value = actor.name;
  }

  ctx.view.addEventListener("click", (e) => {
    const t = e.target;
    const copy = t.closest("[data-copy]");
    if (copy) return copyText(copy.dataset.copy, copy);
    if (t.closest("[data-copy-config]")) return copyText($("#configJson", ctx.view).textContent, t.closest("button"));
    if (t.closest("[data-refresh-server]")) return loadServer();
    if (t.closest("[data-toggle-token]")) {
      const input = $("#tokenInput", ctx.view);
      input.type = input.type === "password" ? "text" : "password";
      t.closest("button").textContent = input.type === "password" ? "Show" : "Hide";
    }
    if (t.closest("[data-reset-token]")) {
      $("#tokenInput", ctx.view).value = DEFAULT_TOKEN;
      $("#tokenForm", ctx.view).requestSubmit();
    }
  });
  ctx.view.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id === "tokenForm") {
      const result = $("#tokenResult", ctx.view);
      setToken($("#tokenInput", ctx.view).value.trim());
      result.className = "muted";
      result.textContent = "Testing…";
      try {
        await getMeta();
        result.className = "ok-text";
        result.textContent = "Token accepted ✓";
        document.querySelector(".auth-banner")?.remove();
      } catch (err) {
        result.className = "error-text";
        result.textContent = err.status === 401 ? "The server rejected this token (401)." : err.message;
      }
      loadServer();
    }
    if (e.target.id === "actorForm") {
      const id = $("#actorSelect", ctx.view).value;
      const name = $("#actorName", ctx.view).value.trim();
      setActor({ id, name });
      $("#actorResult", ctx.view).textContent = "Saved";
      window.dispatchEvent(new CustomEvent("actor-change"));
      toast(`Acting as ${name}`);
    }
  });
  $("#actorSelect", ctx.view).addEventListener("change", (e) => {
    $("#actorName", ctx.view).value = e.target.selectedOptions[0].textContent;
  });

  fillActor();
  loadServer();
  loadConfig();
  await ensureCore();
  if (ctx.isCurrent()) {
    fillActor();
    loadServer();
  }
}
