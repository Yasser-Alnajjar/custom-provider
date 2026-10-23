"use client";

import Link from "next/link";
import { toast } from "sonner";
import { patchTicket } from "@/lib/client/api";
import { useActor } from "@/lib/client/storage";
import { agentHref, customerHref, requesterHref, requesterKey } from "@/lib/directory";
import { absoluteDate, displayName, formatDuration, href, humanize, resolutionMs } from "@/lib/format";
import { firstResponseMs } from "@/lib/ticket-metrics";
import { PRIORITIES, STATUSES, type Ticket, type TicketEvent } from "@/lib/types";
import { Avatar, Muted, StatusBadge } from "../badges";
import { CopyButton } from "../copy-button";
import { useDesk } from "../data-provider";
import { NativeSelect } from "../native-select";
import { Notice, Panel } from "../panel";
import { Time } from "../time";

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-nano font-bold tracking-[0.6px] text-[#6e7e96] uppercase">{children}</div>
);

export function Properties({ ticket, onChanged }: { ticket: Ticket; onChanged: () => Promise<unknown> }) {
  const { directory } = useDesk();
  const actor = useActor();

  const agents = new Map([...directory.agents.values()].map((a) => [a.id, a.name]));
  if (actor.id) agents.set(actor.id, actor.name);
  if (ticket.assignee?.id) agents.set(ticket.assignee.id, ticket.assignee.name ?? ticket.assignee.id);

  async function mutate(patch: Record<string, unknown>, message: string) {
    try {
      await patchTicket(ticket.id, patch);
      toast(message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    await onChanged();
  }

  return (
    <Panel title="Properties">
      <div className="grid gap-3 px-[18px] pb-4">
        <label className="grid gap-1 text-micro text-[#8794aa]">
          Status
          <NativeSelect value={ticket.status} onChange={(e) => mutate({ status: e.target.value }, `Status changed to ${humanize(e.target.value).toLowerCase()}`)}>
            {[...new Set<string>([...STATUSES, ticket.status])].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-micro text-[#8794aa]">
          Priority
          <NativeSelect value={ticket.priority} onChange={(e) => mutate({ priority: e.target.value }, `Priority set to ${e.target.value}`)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-micro text-[#8794aa]">
          Assignee
          <NativeSelect
            value={ticket.assignee?.id ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              const name = agents.get(id);

              void mutate({ assignee: id ? { id, name } : null }, id ? `Assigned to ${name}` : "Ticket unassigned");
            }}
          >
            <option value="">Unassigned</option>
            {[...agents].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </NativeSelect>
        </label>
        <p className="text-nano text-[#6e7e96]">
          Status changes are written to the history; priority and assignee changes are saved but the server does not log them as events.
        </p>
      </div>
    </Panel>
  );
}

function PersonRow({ label, name, sub, to }: { label: string; name?: string | null; sub?: string; to?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      {name ? (
        <div className="flex items-center gap-2">
          <Avatar name={name} />
          <div>
            <div className="text-small">{to ? <Link href={to} className="link">{name}</Link> : name}</div>
            {sub && <div className="text-nano text-[#6e7e96]">{sub}</div>}
          </div>
        </div>
      ) : (
        <Muted>{label === "Assignee" ? "Unassigned" : "None"}</Muted>
      )}
    </div>
  );
}

export function People({ ticket: t }: { ticket: Ticket }) {
  return (
    <Panel title="People">
      <div className="grid gap-3.5 px-[18px] pb-4">
        <PersonRow label="Requester" name={t.requester ? displayName(t.requester) : null} sub={[t.requester?.email, t.requester?.id].filter(Boolean).join(" · ")} to={requesterHref(t.requester)} />
        <PersonRow label="Customer" name={t.customer ? t.customer.name || t.customer.id : null} sub={t.customer?.id ?? ""} to={customerHref(t.customer)} />
        <PersonRow label="Assignee" name={t.assignee?.name} sub={t.assignee?.id ?? ""} to={agentHref(t.assignee)} />
      </div>
    </Panel>
  );
}

function Kv({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line-row py-2 text-small last:border-0">
      <dt className="text-[#78869d]">{k}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Stamp({ value }: { value?: string | null }) {
  if (!value) return <Muted>—</Muted>;
  return (
    <>
      <Time value={value} />
      <div className="text-nano text-[#6e7e96]">{absoluteDate(value)}</div>
    </>
  );
}

export function Timeline({ ticket: t, comments }: { ticket: Ticket; comments: TicketEvent[] | null }) {
  const resolution = resolutionMs(t);
  const first = comments ? firstResponseMs(t, comments) : null;

  return (
    <Panel title="Timeline">
      <dl className="px-[18px] pb-3">
        <Kv k="Created"><Stamp value={t.created_at} /></Kv>
        <Kv k="Last updated"><Stamp value={t.updated_at} /></Kv>
        <Kv k="Resolved">{t.resolved_at ? <Stamp value={t.resolved_at} /> : <Muted>Not resolved</Muted>}</Kv>
        <Kv k="Time to first reply">{first != null ? formatDuration(first) : <Muted>{comments ? "No agent reply yet" : "—"}</Muted>}</Kv>
        <Kv k="Time to resolution">{resolution != null ? formatDuration(resolution) : <Muted>—</Muted>}</Kv>
        <Kv k="Comments">{comments ? `${comments.filter((c) => c.public !== false).length} public · ${comments.filter((c) => c.public === false).length} internal` : "—"}</Kv>
        <Kv k="External URL">
          {t.url ? <><code className="break-all">{t.url}</code> <CopyButton value={t.url} /></> : <Muted>—</Muted>}
        </Kv>
      </dl>
    </Panel>
  );
}

export function Related({ ticket: t }: { ticket: Ticket }) {
  const { tickets, ticketsState, ticketsError } = useDesk();
  const others = tickets.filter((x) => x.id !== t.id);
  const sameReq = t.requester ? others.filter((x) => requesterKey(x.requester) === requesterKey(t.requester)) : [];
  const sameCus = t.customer ? others.filter((x) => x.customer?.id === t.customer?.id && !sameReq.includes(x)) : [];

  const list = (items: Ticket[]) =>
    items.slice(0, 5).map((x) => (
      <Link key={x.id} href={href("tickets", x.id)} className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-hover">
        <span className="link text-small font-semibold">{x.id}</span>
        <span className="min-w-0 flex-1 truncate text-small text-[#b9c5d8]">{x.title}</span>
        <StatusBadge status={x.status} />
      </Link>
    ));

  return (
    <Panel title="Related tickets">
      <div className="grid gap-2 px-[18px] pb-4">
        {ticketsState !== "ready" ? (
          <Muted>Related tickets unavailable{ticketsError ? `: ${ticketsError}` : ""}</Muted>
        ) : (
          <>
            {sameReq.length > 0 && <><Label>Same requester ({sameReq.length})</Label>{list(sameReq)}</>}
            {sameCus.length > 0 && (
              <>
                <Label>Same customer ({sameCus.length})</Label>
                {list(sameCus)}
                {sameCus.length > 5 && <Link href={customerHref(t.customer)} className="link text-small">View all {sameCus.length} →</Link>}
              </>
            )}
            {!sameReq.length && !sameCus.length && <Muted>No other tickets from this requester or customer.</Muted>}
          </>
        )}
      </div>
    </Panel>
  );
}

export function Unsupported() {
  return (
    <Notice tone="subtle">
      <b>Not provided by this API</b><br />
      Attachments, custom fields, ticket type, groups and linked/merged records are not part of the server&apos;s ticket model, so they are not shown.
    </Notice>
  );
}
