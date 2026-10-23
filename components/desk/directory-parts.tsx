"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueryState } from "@/lib/client/use-query-state";
import { compare, plural, time } from "@/lib/format";
import type { Ticket, TicketEvent } from "@/lib/types";
import { Avatar } from "./badges";
import { useDesk } from "./data-provider";
import { EventItem } from "./event-item";
import { PageHeader } from "./page-header";
import { Pager } from "./pager";
import { Empty, ErrorState, Panel } from "./panel";
import { nextSort, SortHeader } from "./sort-header";

export function PersonCell({ name, sub }: { name: string; sub?: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar name={name} />
      <div>
        <div className="text-small text-foreground">{name}</div>
        {sub && <div className="text-nano text-[#6e7e96]">{sub}</div>}
      </div>
    </div>
  );
}

export function RecentEvents({ events, limit = 10 }: { events: TicketEvent[]; limit?: number }) {
  const { ticketById } = useDesk();

  if (!events.length) return <Empty>No activity recorded.</Empty>;
  return (
    <div className="px-[18px] pb-3">
      {[...events].sort((a, b) => time(b.created_at) - time(a.created_at)).slice(0, limit).map((e) => (
        <EventItem key={e.id} event={e} ticket={ticketById(e.ticket_id)} />
      ))}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  /** Numeric and date columns sort high-to-low first. */
  desc?: boolean;
  sortValue: (item: T) => string | number | null | undefined;
  render: (item: T) => React.ReactNode;
}

interface ListConfig<T> {
  title: string;
  noun: string;
  subtitle: React.ReactNode;
  placeholder: string;
  sort: string;
  empty: string;
  items: T[];
  search: (item: T) => (string | null | undefined)[];
  href: (item: T) => string;
  columns: Column<T>[];
}

/** A searchable, sortable, paginated directory table. */
export function DirectoryList<T>(cfg: ListConfig<T>) {
  const desk = useDesk();
  const router = useRouter();
  const [f, setF] = useQueryState({ q: "", sort: cfg.sort, page: 1, size: 25 });
  const sort = cfg.columns.some((c) => c.key === f.sort.split(":")[0]) ? f.sort : cfg.sort;

  const list = useMemo(() => {
    const q = f.q.toLowerCase().trim();
    const [field, dir] = sort.split(":");
    const col = cfg.columns.find((c) => c.key === field)!;

    return cfg.items
      .filter((x) => !q || cfg.search(x).filter(Boolean).join(" ").toLowerCase().includes(q))
      .sort((a, b) => compare(col.sortValue(a), col.sortValue(b)) * (dir === "desc" ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.items, f.q, sort]);

  const page = Math.min(Math.max(1, f.page), Math.max(1, Math.ceil(list.length / f.size)));
  const rows = list.slice((page - 1) * f.size, page * f.size);

  let body: React.ReactNode;

  if (desk.ticketsState === "loading") body = <Empty>Loading…</Empty>;
  else if (desk.ticketsState === "error" && !desk.tickets.length) body = <ErrorState message={`Could not load tickets: ${desk.ticketsError}`} onRetry={desk.reload} />;
  else if (!rows.length) {
    body = (
      <Empty>
        {cfg.items.length ? (
          <>Nothing matches &quot;{f.q}&quot;.<br /><Button variant="link" size="sm" onClick={() => setF({ q: "" })}>Clear search</Button></>
        ) : cfg.empty}
      </Empty>
    );
  } else {
    body = (
      <>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse whitespace-nowrap">
            <thead>
              <tr>
                {cfg.columns.map((c) => (
                  <SortHeader key={c.key} label={c.label} field={c.key} sort={sort} onSort={(k) => setF({ sort: nextSort(sort, k, c.desc ? "desc" : "asc") })} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={cfg.href(x)} className="cursor-pointer hover:bg-hover" onClick={(e) => { if (!(e.target as HTMLElement).closest("a, button")) router.push(cfg.href(x)); }}>
                  {cfg.columns.map((c) => <td key={c.key} className="td">{c.render(x)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager total={list.length} page={page} size={f.size} onPage={(p) => setF({ page: p })} onSize={(s) => setF({ size: s, page: 1 })} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={cfg.title}
        subtitle={cfg.subtitle}
        actions={<Button variant="outline" onClick={() => desk.reload().then(() => toast("Data refreshed"))}>↻ Refresh data</Button>}
      />
      <Panel>
        <div className="flex items-center gap-2 p-3.5">
          <div className="min-w-[220px] flex-1">
            <Input aria-label={`Search ${cfg.title.toLowerCase()}`} value={f.q} onChange={(e) => setF({ q: e.target.value, page: 1 })} placeholder={cfg.placeholder} />
          </div>
          <span className="text-micro text-[#6e7e96]">
            {list.length === cfg.items.length ? plural(cfg.items.length, cfg.noun) : `${list.length} of ${plural(cfg.items.length, cfg.noun)}`}
          </span>
        </div>
        {body}
      </Panel>
    </>
  );
}

/** Shell for customer / requester / agent detail pages: loading, error and not-found states. */
export function DetailPage<T>({
  section,
  find,
  id,
  render,
}: {
  section: "Customers" | "Requesters" | "Agents";
  find: (id: string) => T | undefined;
  id: string;
  render: (entity: T, crumbs: { label: string; href: string }[]) => React.ReactNode;
}) {
  const desk = useDesk();
  const crumbs = [{ label: section, href: `/${section.toLowerCase()}` }];

  if (desk.ticketsState === "loading") return <Panel><Empty>Loading…</Empty></Panel>;

  if (desk.ticketsState === "error" && !desk.tickets.length) {
    return (
      <>
        <PageHeader crumbs={crumbs} title={section.replace(/s$/, "")} />
        <Panel><ErrorState message={`Could not load tickets: ${desk.ticketsError}`} onRetry={desk.reload} /></Panel>
      </>
    );
  }

  const entity = find(id);

  if (!entity) {
    return (
      <>
        <PageHeader crumbs={crumbs} title={id} />
        <Panel>
          <Empty className="text-bad">
            No {section.toLowerCase().replace(/s$/, "")} found with this identifier.<br />
            <Link href={crumbs[0].href} className="link">Back to {section.toLowerCase()}</Link>
          </Empty>
        </Panel>
      </>
    );
  }

  return <>{render(entity, crumbs)}</>;
}

export const recentFirst = (a: Ticket, b: Ticket) => time(b.updated_at) - time(a.updated_at);
