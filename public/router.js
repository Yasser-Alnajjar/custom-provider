// Minimal History-API router. Routes render into #view; list pages keep their
// filters in the query string so a refresh or a shared link restores them.

import { $, $$ } from "./lib.js";

const routes = [];
let current = null; // { leave: [], token }
let seq = 0;
let notFound = null;

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp(
    "^" +
      pattern.replace(/:([a-z]+)/g, (_, k) => {
        keys.push(k);
        return "([^/]+)";
      }) +
      "/?$",
  );
  routes.push({ regex, keys, handler });
}
export const onNotFound = (handler) => (notFound = handler);

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  return render();
}
export const reload = () => render();

function navFor(pathname) {
  const first = pathname.split("/")[1] || "";
  return first === "" ? "overview" : first;
}

export async function render() {
  const token = ++seq;
  current?.leave.forEach((fn) => fn());
  const leave = [];
  current = { leave, token };

  const { pathname } = location;
  const view = $("#view");
  let handler = notFound;
  let params = {};
  for (const r of routes) {
    const m = pathname.match(r.regex);
    if (m) {
      handler = r.handler;
      params = Object.fromEntries(
        r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]),
      );
      break;
    }
  }
  const nav = navFor(pathname);
  for (const a of $$(".nav[data-nav]"))
    a.classList.toggle("active", a.dataset.nav === nav);
  view.innerHTML = "";
  window.scrollTo(0, 0);

  const ctx = {
    view,
    params,
    // False once the user navigated elsewhere; async code must stop touching the DOM.
    isCurrent: () => token === seq,
    onLeave: (fn) => leave.push(fn),
    title: (t) => (document.title = t ? `${t} — Acme Desk` : "Acme Desk — Custom Provider Lab"),
  };
  ctx.title("");
  try {
    await handler(ctx);
  } catch (e) {
    console.error(e);
    if (ctx.isCurrent())
      view.innerHTML = `<div class="panel"><div class="empty error-state">Something went wrong rendering this page: ${String(e.message)
        .replace(/</g, "&lt;")}<br><a class="text-btn" href="/">Back to overview</a></div></div>`;
  }
  if (ctx.isCurrent() && location.hash) {
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "center" });
  }
}

export function startRouter() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    if (!a || a.target || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith("/api/") || /\.\w+$/.test(url.pathname)) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
  window.addEventListener("popstate", render);
  return render();
}
