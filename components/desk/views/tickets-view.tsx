"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { patchTicket } from "@/lib/client/api";
import { useQueryState } from "@/lib/client/use-query-state";
import { customerHref, customerKey, requesterHref } from "@/lib/directory";
import { filterTickets, sortTickets, TICKET_SORTERS } from "@/lib/filters";
import { displayName, formatDuration, href, humanize, initials, plural, relativeTime, resolutionMs, toDate } from "@/lib/format";
import { PRIORITIES, STATUSES, type Ticket } from "@/lib/types";
import { Muted, PriorityBadge, StatusBadge } from "../badges";
import { useDesk } from "../data-provider";
import { NativeSelect } from "../native-select";
import { PageHeader } from "../page-header";
import { Pager } from "../pager";
import { Empty, ErrorState, Notice, Panel } from "../panel";
import { nextSort, SortHeader } from "../sort-header";
import { CreateTicketDialog } from "../ticket-dialogs";
import { Time } from "../time";

const DEFAULTS = {
  q: "", status: "", priority: "", assignee: "", customer: "", channel: "", tag: "",
  sort: "updated_at:desc", page: 1, size: 25,
};

// Statuses the "next status" row action cycles through ("new" is a starting state only).
const CYCLE_STATUSES = ["open", "in_progress", "pending", "solved", "closed"];

export function TicketsView() {
  const desk = useDesk();
  const router = useRouter();
  const [f, setF] = useQueryState(DEFAULTS);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const { tickets, directory } = desk;

  const sort = TICKET_SORTERS[f.sort.split(":")[0]] ? f.sort : DEFAULTS.sort;
  const filtered = useMemo(() => sortTickets(filterTickets(tickets, f), sort), [tickets, f, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / f.size));
  const page = Math.min(Math.max(1, f.page), pages);
  const rows = filtered.slice((page - 1) * f.size, page * f.size);

  const customerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tickets) {
      const k = customerKey(t.customer);
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  }, [tickets]);

  const count = (fn: (t: Ticket) => boolean) => tickets.filter(fn).length;
  const statuses = [...new Set<string>([...STATUSES, ...tickets.map((t) => t.status)])];
  const channels = [...new Set(tickets.map((t) => t.channel).filter((c): c is string => Boolean(c)))].sort();
  const tags = [...new Set(tickets.flatMap((t) => t.tags || []))].sort();
  const filter = (key: keyof typeof DEFAULTS) => (e: React.ChangeEvent<HTMLSelectElement>) => setF({ [key]: e.target.value, page: 1 });

  async function cycle(ticket: Ticket) {
    if (busy.has(ticket.id)) return;

    const next = CYCLE_STATUSES[(CYCLE_STATUSES.indexOf(ticket.status) + 1) % CYCLE_STATUSES.length];

    setBusy((s) => new Set(s).add(ticket.id));
    try {
      // The server sets resolved_at and records the transition in the history.
      await patchTicket(ticket.id, { status: next });
      toast(`${ticket.id} moved to ${humanize(next).toLowerCase()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy((s) => {
        const copy = new Set(s);
        copy.delete(ticket.id);
        return copy;
      });
      await desk.reload();
    }
  }

  let results: React.ReactNode;

  if (desk.ticketsState === "loading") {
    results = <Empty>Loading tickets…</Empty>;
  } else if (desk.ticketsState === "error" && !tickets.length) {
    results = <ErrorState message={`Could not load tickets: ${desk.ticketsError}`} onRetry={desk.reload} />;
  } else {
    results = (
      <>
        {desk.ticketsState === "error" && <Notice>Showing the last loaded data — refreshing failed: {desk.ticketsError}</Notice>}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse whitespace-nowrap">
            <thead>
              <tr>
                {([["TICKET", "id"], ["REQUESTER", "requester"], ["CUSTOMER", "customer"], ["STATUS", "status"], ["PRIORITY", "priority"], ["UPDATED", "updated_at"]] as const).map(([label, field]) => (
                  <SortHeader
                    key={field}
                    label={label}
                    field={field}
                    sort={sort}
                    onSort={(k) => setF({ sort: nextSort(sort, k, ["updated_at", "created_at", "priority"].includes(k) ? "desc" : "asc") })}
                  />
                ))}
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((t) => (
                  <TicketRow key={t.id} ticket={t} customerCount={customerCounts.get(customerKey(t.customer)) || 0} busy={busy.has(t.id)} onCycle={() => cycle(t)} onOpen={() => router.push(href("tickets", t.id))} />
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <Empty>
                      {tickets.length ? (
                        <>
                          No tickets match your filters.<br />
                          <Button variant="link" size="sm" onClick={() => setF({ ...DEFAULTS, sort: f.sort, size: f.size })}>Clear filters</Button>
                        </>
                      ) : (
                        "No tickets yet. Create the first one to get started."
                      )}
                    </Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && <Pager total={filtered.length} page={page} size={f.size} onPage={(p) => { setF({ page: p }); window.scrollTo({ top: 0 }); }} onSize={(s) => setF({ size: s, page: 1 })} />}
        <div className="flex justify-between border-t px-[18px] py-[11px] text-micro text-[#6e7e96]">
          <span>Data is stored in Supabase, or in a JSON file (public/db.json) when it is not configured.</span>
          <span>REST API · JSON</span>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Tickets"
        subtitle={<>Every ticket exposed by <code>GET /api/tickets</code>. Open one to see its comments, internal notes and history.</>}
        actions={
          <>
            <Button variant="outline" onClick={() => desk.reload().then(() => toast("Data refreshed"))}>↻ Refresh data</Button>
            <Button onClick={() => setCreating(true)}>＋ Create ticket</Button>
          </>
        }
      />
      <Panel>
        <div className="flex flex-wrap items-center gap-2 p-3.5">
          <div className="flex min-w-[220px] flex-1 items-center gap-2">
            <Input aria-label="Search tickets" value={f.q} onChange={(e) => setF({ q: e.target.value, page: 1 })} placeholder="Search ID, title, requester, customer, tag…" />
          </div>
          <NativeSelect aria-label="Status" value={f.status} onChange={filter("status")}>
            <option value="">All statuses</option>
            <option value="open,in_progress">Open + in progress ({count((t) => ["open", "in_progress"].includes(t.status))})</option>
            <option value="solved,closed">Solved + closed ({count((t) => ["solved", "closed"].includes(t.status))})</option>
            {statuses.map((s) => <option key={s} value={s}>{humanize(s)} ({count((t) => t.status === s)})</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Priority" value={f.priority} onChange={filter("priority")}>
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Assignee" value={f.assignee} onChange={filter("assignee")}>
            <option value="">Any assignee</option>
            <option value="none">Unassigned</option>
            {[...directory.agents.values()].filter((a) => a.tickets.length || a.id === f.assignee).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Customer" value={f.customer} onChange={filter("customer")}>
            <option value="">All customers</option>
            {[...directory.customers.values()].map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Channel" value={f.channel} onChange={filter("channel")}>
            <option value="">All channels</option>
            {channels.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Tag" value={f.tag} onChange={filter("tag")}>
            <option value="">All tags</option>
            {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
          </NativeSelect>
          <span className="ml-auto text-micro text-[#6e7e96]">
            {desk.ticketsState === "ready" ? (filtered.length === tickets.length ? plural(tickets.length, "record") : `${filtered.length} of ${plural(tickets.length, "record")}`) : "—"}
          </span>
        </div>
        {results}
      </Panel>
      {creating && <CreateTicketDialog open onOpenChange={setCreating} onCreated={(t) => router.push(href("tickets", t.id))} />}
    </>
  );
}

function TicketRow({ ticket: t, customerCount, busy, onCycle, onOpen }: { ticket: Ticket; customerCount: number; busy: boolean; onCycle: () => void; onOpen: () => void }) {
  const requesterName = displayName(t.requester);
  const resolution = resolutionMs(t);
  const timeNote = resolution !== null ? `Resolved in ${formatDuration(resolution)}` : toDate(t.created_at) ? `Opened ${relativeTime(t.created_at)}` : "";
  const reqHref = requesterHref(t.requester);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <tr className="cursor-pointer hover:bg-hover" onClick={onOpen}>
      <td className="td">
        <Link href={href("tickets", t.id)} className="link font-semibold" onClick={stop}>{t.id}</Link>
        <div className="mt-[3px] text-small text-foreground" title={t.description || ""}>{t.title || "Untitled ticket"}</div>
        <div className="mt-[3px] text-nano text-[#6e7e96]">
          {t.assignee ? `Assigned to ${displayName(t.assignee)}` : "Unassigned"}
          {(t.tags || []).length > 0 && ` · ${t.tags.map((x) => `#${x}`).join(" ")}`}
        </div>
      </td>
      <td className="td">
        {requesterName ? (
          <div className="flex items-center gap-2">
            <div className="grid size-6 place-items-center rounded-full bg-[#27344c] text-nano font-bold text-[#b8d9ff]">{initials(requesterName)}</div>
            <div>
              <div className="text-small text-foreground">{reqHref ? <Link href={reqHref} className="link" onClick={stop}>{requesterName}</Link> : requesterName}</div>
              {t.requester?.name && t.requester.email && <div className="text-nano text-[#6e7e96]">{t.requester.email}</div>}
            </div>
          </div>
        ) : <Muted>No requester</Muted>}
      </td>
      <td className="td">
        {t.customer?.name ? (
          <>
            <div className="text-small"><Link href={customerHref(t.customer)} className="link" onClick={stop}>{t.customer.name}</Link></div>
            <div className="text-nano text-[#6e7e96]">{plural(customerCount, "ticket")}</div>
          </>
        ) : <Muted>No customer</Muted>}
      </td>
      <td className="td"><StatusBadge status={t.status} /></td>
      <td className="td"><PriorityBadge priority={t.priority} /></td>
      <td className="td">
        <span className="text-micro text-[#7d8ba2]"><Time value={t.updated_at} /></span>
        {timeNote && <div className="text-nano text-[#6e7e96]">{timeNote}</div>}
      </td>
      <td className="td">
        <Button variant="ghost" size="icon-sm" title="Move to next status" aria-label={`Move ${t.id} to next status`} disabled={busy} onClick={(e) => { e.stopPropagation(); onCycle(); }}>···</Button>
      </td>
    </tr>
  );
}


