"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueryState } from "@/lib/client/use-query-state";
import { filterEvents } from "@/lib/filters";
import { humanize, plural, time } from "@/lib/format";
import { useDesk } from "../data-provider";
import { EventItem } from "../event-item";
import { NativeSelect } from "../native-select";
import { PageHeader } from "../page-header";
import { Pager } from "../pager";
import { Empty, ErrorState, Panel } from "../panel";

const DEFAULTS = { q: "", type: "", visibility: "", role: "", order: "desc", page: 1, size: 25 };

export function ActivityView() {
  const desk = useDesk();
  const [f, setF] = useQueryState(DEFAULTS);
  const { events } = desk;

  const list = useMemo(() => {
    const sign = f.order === "asc" ? 1 : -1;
    return filterEvents(events, f, (id) => desk.ticketById(id)?.title).sort((a, b) => sign * (time(a.created_at) - time(b.created_at)));
  }, [events, f, desk]);

  const page = Math.min(Math.max(1, f.page), Math.max(1, Math.ceil(list.length / f.size)));
  const rows = list.slice((page - 1) * f.size, page * f.size);
  const types = [...new Set(events.map((e) => e.type))];
  const roles = [...new Set(events.map((e) => e.author?.role).filter((r): r is NonNullable<typeof r> => Boolean(r)))];
  const filter = (key: keyof typeof DEFAULTS) => (e: React.ChangeEvent<HTMLSelectElement>) => setF({ [key]: e.target.value, page: 1 });

  let body: React.ReactNode;

  if (desk.eventsState === "loading") body = <Empty>Loading activity…</Empty>;
  else if (desk.eventsState === "error" && !events.length) body = <ErrorState message={`Could not load activity: ${desk.eventsError}`} onRetry={desk.reload} />;
  else {
    body = (
      <>
        <div className="px-[18px] pb-3">
          {rows.length ? (
            rows.map((e) => <EventItem key={e.id} event={e} ticket={desk.ticketById(e.ticket_id)} />)
          ) : (
            <Empty>
              {events.length ? (
                <>No events match your filters.<br /><Button variant="link" size="sm" onClick={() => setF({ ...DEFAULTS, size: f.size })}>Clear filters</Button></>
              ) : "No activity yet."}
            </Empty>
          )}
        </div>
        {list.length > 0 && <Pager total={list.length} page={page} size={f.size} onPage={(p) => { setF({ page: p }); window.scrollTo({ top: 0 }); }} onSize={(s) => setF({ size: s, page: 1 })} />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle={<>All events recorded by the provider (<code>GET /api/events</code>): ticket creation, comments, internal notes and status changes.</>}
        actions={<Button variant="outline" onClick={() => desk.reload().then(() => toast("Data refreshed"))}>↻ Refresh data</Button>}
      />
      <Panel>
        <div className="flex flex-wrap items-center gap-2 p-3.5">
          <div className="min-w-[220px] flex-1">
            <Input aria-label="Search activity" value={f.q} onChange={(e) => setF({ q: e.target.value, page: 1 })} placeholder="Search ticket ID, text or author…" />
          </div>
          <NativeSelect aria-label="Event type" value={f.type} onChange={filter("type")}>
            <option value="">All event types</option>
            {types.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Visibility" value={f.visibility} onChange={filter("visibility")}>
            <option value="">Public + internal</option>
            <option value="public">Public only</option>
            <option value="internal">Internal notes only</option>
          </NativeSelect>
          <NativeSelect aria-label="Author role" value={f.role} onChange={filter("role")}>
            <option value="">Any author</option>
            {roles.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Order" value={f.order} onChange={filter("order")}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </NativeSelect>
          <span className="ml-auto text-micro text-[#6e7e96]">
            {desk.eventsState === "ready" ? (list.length === events.length ? plural(list.length, "event") : `${list.length} of ${plural(events.length, "event")}`) : "—"}
          </span>
        </div>
        {body}
      </Panel>
    </>
  );
}
