import { $, esc, initials, refreshTimes } from "./lib.js";
import { getActor } from "./api.js";
import { store } from "./store.js";
import { route, onNotFound, startRouter } from "./router.js";
import { overviewPage } from "./page-overview.js";
import { ticketsPage } from "./page-tickets.js";
import { ticketPage } from "./page-ticket.js";
import { activityPage } from "./page-activity.js";
import {
  customersPage, customerPage, requestersPage, requesterPage, agentsPage, agentPage,
} from "./page-directory.js";
import { providerPage } from "./page-provider.js";

route("/", overviewPage);
route("/tickets", ticketsPage);
route("/tickets/:id", ticketPage);
route("/activity", activityPage);
route("/customers", customersPage);
route("/customers/:key", customerPage);
route("/requesters", requestersPage);
route("/requesters/:key", requesterPage);
route("/agents", agentsPage);
route("/agents/:id", agentPage);
route("/provider", providerPage);
onNotFound((ctx) => {
  ctx.title("Page not found");
  ctx.view.innerHTML = `<header><div><div class="breadcrumbs"><a href="/">Overview</a> <span>/</span> <b>Not found</b></div><h1>Page not found</h1></div></header>
    <div class="panel"><div class="empty error-state">There is no page at <code>${esc(location.pathname)}</code>.<br><a class="text-btn" href="/">Back to overview</a></div></div>`;
});

// ----- shell: API status, auth banner, sidebar counts, actor ---------------------------------
window.addEventListener("api-status", (e) => {
  const el = $("#apiStatus");
  el.classList.toggle("offline", !e.detail.online);
  el.lastElementChild.textContent = e.detail.online ? "API online" : "API unreachable";
});
window.addEventListener("auth-error", () => {
  if ($(".auth-banner")) return;
  $("main").insertAdjacentHTML(
    "afterbegin",
    `<div class="auth-banner" role="alert">The server rejected the API token (401). <a href="/provider">Update the token</a> to continue.</div>`,
  );
});
function drawSidebar() {
  const ready = store.ticketsState === "ready";
  $("#ticketCount").textContent = ready ? store.tickets.length : "";
  const actor = getActor();
  $("#actorAvatar").textContent = initials(actor.name);
  $("#sidebarActor").textContent = actor.name;
}
window.addEventListener("store-change", drawSidebar);
window.addEventListener("actor-change", drawSidebar);
drawSidebar();

// Relative timestamps stay fresh without refetching.
setInterval(() => refreshTimes(), 60000);

startRouter();
