"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, getElapsedConfig, getHealth, getMeta } from "@/lib/client/api";
import { DEFAULT_TOKEN, setActor, setToken, useActor, useToken } from "@/lib/client/storage";
import { humanize, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Chip, Muted } from "../badges";
import { CopyButton } from "../copy-button";
import { useDesk } from "../data-provider";
import { NativeSelect } from "../native-select";
import { PageHeader } from "../page-header";
import { Panel } from "../panel";

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
] as const;

const METHOD_STYLE: Record<string, string> = {
  GET: "bg-[#132c42] text-[#6dc8ff]",
  POST: "bg-ok-bg text-ok",
  PATCH: "bg-warn-bg text-warn",
};

function Row({ label, children, action }: { label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line-row px-[18px] py-3">
      <div className="min-w-0">
        <div className="mb-1 text-nano font-bold tracking-[0.6px] text-[#6e7e96] uppercase">{label}</div>
        {children}
      </div>
      {action}
    </div>
  );
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: ApiError };

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e : new ApiError(String(e)) };
  }
}

function ServerInfo() {
  const { tickets, events, ticketsState } = useDesk();
  const token = useToken();
  const [info, setInfo] = useState<{ health: Settled<Awaited<ReturnType<typeof getHealth>>>; meta: Settled<Awaited<ReturnType<typeof getMeta>>> } | null>(null);

  const load = useCallback(async () => {
    const [health, meta] = await Promise.all([settle(getHealth()), settle(getMeta())]);
    setInfo({ health, meta });
  }, []);

  useEffect(() => {
    // Fetch when mounted and when the token changes; state is set once both requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, token]);

  const err = (r: { ok: false; error: ApiError }) => (
    <span className="text-bad">{r.error.message}{r.error.status === 401 ? " — check the API token" : ""}</span>
  );

  return (
    <Panel
      title="Server"
      description={<>Live responses from <code>/health</code> and <code>/api/meta</code>.</>}
      action={<Button variant="link" size="sm" onClick={load}>Refresh ↻</Button>}
    >
      {!info ? (
        <Row label="Status"><Muted>Loading…</Muted></Row>
      ) : (
        <>
          <Row label="Health">
            {info.health.ok ? <code>{info.health.value.ok ? "ok" : "not ok"} · {info.health.value.provider} · v{info.health.value.version}</code> : err(info.health)}
          </Row>
          <Row label="API version / auth">
            {info.meta.ok ? <code>{info.meta.value.api_version} · {info.meta.value.auth}</code> : err(info.meta)}
          </Row>
          <Row label="Capabilities">
            {info.meta.ok ? <div className="flex flex-wrap gap-1.5">{info.meta.value.capabilities.map((c) => <Chip key={c}>{humanize(c)}</Chip>)}</div> : err(info.meta)}
          </Row>
          <Row label="Loaded in this UI">
            {ticketsState === "ready" ? <code>{plural(tickets.length, "ticket")} · {plural(events.length, "event")}</code> : <Muted>Not loaded</Muted>}
          </Row>
        </>
      )}
    </Panel>
  );
}

function TokenForm() {
  const stored = useToken();
  const [value, setValue] = useState(stored);
  const [shown, setShown] = useState(false);
  const [result, setResult] = useState<{ tone: "muted" | "ok" | "bad"; text: string }>({ tone: "muted", text: "" });

  async function save(token: string) {
    setToken(token.trim());
    setResult({ tone: "muted", text: "Testing…" });
    try {
      await getMeta();
      setResult({ tone: "ok", text: "Token accepted ✓" });
    } catch (e) {
      const err = e as ApiError;
      setResult({ tone: "bad", text: err.status === 401 ? "The server rejected this token (401)." : err.message });
    }
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void save(value); }}
      className="grid gap-3 border-t border-line-row px-[18px] py-4"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="token">API token used by this UI</Label>
        <div className="flex gap-2">
          <Input id="token" type={shown ? "text" : "password"} autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
          <Button type="button" variant="outline" onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show"}</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">Save &amp; test</Button>
        <Button type="button" variant="outline" onClick={() => { setValue(DEFAULT_TOKEN); void save(DEFAULT_TOKEN); }}>Use default</Button>
        <span className={cn("text-small", result.tone === "ok" && "text-ok", result.tone === "bad" && "text-bad", result.tone === "muted" && "text-[#78869d]")}>{result.text}</span>
      </div>
      <p className="text-micro text-[#78869d]">
        The server&apos;s token is set with the <code>API_TOKEN</code> environment variable (default <code>{DEFAULT_TOKEN}</code>). It is kept in this browser only.
      </p>
    </form>
  );
}

function ActingAs() {
  const { directory } = useDesk();
  const actor = useActor();
  const [id, setId] = useState(actor.id ?? "");
  const [name, setName] = useState(actor.name);
  const agents = new Map([...directory.agents.values()].map((a) => [a.id, a.name]));

  if (actor.id) agents.set(actor.id, actor.name);

  return (
    <Panel id="identity" title="Acting as" description="The server has no user accounts. Comments written from this UI are posted under this agent identity.">
      <form
        className="grid gap-3 px-[18px] pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          setActor({ id, name: name.trim() });
          toast(`Acting as ${name.trim()}`);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Agent</Label>
            <NativeSelect value={id} onChange={(e) => { setId(e.target.value); setName(agents.get(e.target.value) ?? name); }}>
              {[...agents].map(([aid, n]) => <option key={aid} value={aid}>{n}</option>)}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="actorName">Display name</Label>
            <Input id="actorName" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div><Button type="submit">Save identity</Button></div>
      </form>
    </Panel>
  );
}

export function ProviderView() {
  // The origin is only known in the browser.
  const origin = useSyncExternalStore(
    () => () => {},
    () => location.origin,
    () => "",
  );
  const [config, setConfig] = useState("Loading…");

  useEffect(() => {
    getElapsedConfig().then(
      (cfg) => setConfig(JSON.stringify(cfg, null, 2)),
      (e) => setConfig(`Could not load /elapsed-config.json: ${e instanceof Error ? e.message : e}`),
    );
  }, []);

  const configUrl = `${origin.replace("localhost", "127.0.0.1")}/elapsed-config.json`;

  return (
    <>
      <PageHeader title="Provider" subtitle="Connection details for Elapsed, the API token this UI uses, and live server information." />
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Panel title="Connection" description="Use these values in the Elapsed setup wizard." action={<span className="rounded bg-[#132c42] px-1.5 py-0.5 text-nano text-[#6dc8ff]">v1</span>}>
          <Row label="Base URL" action={<CopyButton value={`${origin}/api`} />}><code>{origin}/api</code></Row>
          <Row label="Authentication"><code>Authorization: Bearer &lt;token&gt;</code> <Muted>or</Muted> <code>X-Api-Key</code></Row>
          <Row label="Elapsed config document" action={<CopyButton value={configUrl} />}><code>{configUrl}</code></Row>
          <TokenForm />
          <div className="m-[18px] rounded-lg border border-[#1e4967] bg-[#102a40] p-3 text-micro text-[#9cc9e8]">
            <b>For a remote Elapsed instance</b>
            <p className="mt-1"><code>localhost</code> refers to the machine running Elapsed, not your laptop. Use <code>127.0.0.1</code>, or <code>host.docker.internal</code> if Elapsed runs in Docker. Do not expose the demo publicly without restricting access.</p>
          </div>
        </Panel>
        <ServerInfo />
      </div>
      <ActingAs />
      <Panel title="API endpoints" description="Every route the server exposes and where this UI uses it.">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse whitespace-nowrap">
            <thead><tr>{["METHOD", "PATH", "PURPOSE", "USED IN", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {ENDPOINTS.map(([m, p, d, u]) => (
                <tr key={m + p}>
                  <td className="td"><span className={cn("inline-block rounded px-1.5 py-[3px] text-nano font-bold", METHOD_STYLE[m])}>{m}</span></td>
                  <td className="td"><code>{p}</code></td>
                  <td className="td">{d}</td>
                  <td className="td">{u}</td>
                  <td className="td"><CopyButton label="Copy URL" value={origin + p.split("?")[0].replace(":id", "TCK-1001")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t px-[18px] py-[11px] text-micro text-[#6e7e96]">
          Not provided by the server: users, customers, groups, attachments, custom fields, delete operations, pagination on comments/events.
        </div>
      </Panel>
      <Panel title="Elapsed configuration" description="Paste this into Elapsed's Advanced (JSON) step." action={<div className="flex gap-2"><Button variant="outline" size="xs" nativeButton={false} render={<Link href="/config-builder" />}>Edit in builder</Button><CopyButton value={config} label="Copy JSON" /></div>}>
        <pre className="max-h-[480px] overflow-auto bg-deep px-[18px] py-3.5 font-mono text-micro text-[#b9d9f8]">{config}</pre>
      </Panel>
    </>
  );
}
