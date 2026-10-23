"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { agentHref, customerHref, lastActivity, requesterHref, requesterKey } from "@/lib/directory";
import { formatDuration, plural, time } from "@/lib/format";
import { agentStats, ticketStats } from "@/lib/stats";
import { Muted } from "../badges";
import { useDesk } from "../data-provider";
import { DetailPage, DirectoryList, PersonCell, RecentEvents, recentFirst } from "../directory-parts";
import { PageHeader } from "../page-header";
import { Empty, Panel, StatGrid } from "../panel";
import { CompactTickets } from "../tickets-table";
import { Time } from "../time";

const ago = (iso: string | null) => (iso ? <Time value={iso} /> : <Muted>—</Muted>);
const dash = <Muted>—</Muted>;

export function CustomersView() {
  const { directory } = useDesk();

  return (
    <DirectoryList
      title="Customers"
      noun="customer"
      subtitle={<>Organisations that raised tickets. Derived from the <code>customer</code> object on each ticket.</>}
      placeholder="Search customers or requesters…"
      sort="name:asc"
      empty="No customers yet — they appear as soon as a ticket has one."
      items={[...directory.customers.values()]}
      search={(c) => [c.name, c.id, ...[...c.requesters.values()].flatMap((r) => [r.name, r.email])]}
      href={(c) => customerHref(c)}
      columns={[
        { key: "name", label: "CUSTOMER", sortValue: (c) => c.name.toLowerCase(), render: (c) => <PersonCell name={c.name} sub={c.id} /> },
        { key: "requesters", label: "REQUESTERS", desc: true, sortValue: (c) => c.requesters.size, render: (c) => c.requesters.size },
        { key: "tickets", label: "TICKETS", desc: true, sortValue: (c) => c.tickets.length, render: (c) => c.tickets.length },
        { key: "open", label: "OPEN", desc: true, sortValue: (c) => ticketStats(c.tickets).open, render: (c) => ticketStats(c.tickets).open },
        { key: "avg", label: "AVG. RESOLUTION", sortValue: (c) => ticketStats(c.tickets).avg, render: (c) => { const a = ticketStats(c.tickets).avg; return a == null ? dash : formatDuration(a); } },
        { key: "updated", label: "LAST ACTIVITY", desc: true, sortValue: (c) => time(lastActivity(c.tickets)), render: (c) => ago(lastActivity(c.tickets)) },
      ]}
    />
  );
}

export function RequestersView() {
  const { directory } = useDesk();

  return (
    <DirectoryList
      title="Requesters"
      noun="requester"
      subtitle={<>People who opened tickets. Derived from the <code>requester</code> object on each ticket.</>}
      placeholder="Search name, email or customer…"
      sort="name:asc"
      empty="No requesters yet."
      items={[...directory.requesters.values()]}
      search={(r) => [r.name, r.email, r.id, ...[...r.customers.values()].map((c) => c.name)]}
      href={(r) => requesterHref(r)}
      columns={[
        { key: "name", label: "REQUESTER", sortValue: (r) => r.name?.toLowerCase(), render: (r) => <PersonCell name={r.name} sub={r.email} /> },
        {
          key: "customer",
          label: "CUSTOMER",
          sortValue: (r) => [...r.customers.values()][0]?.name?.toLowerCase(),
          render: (r) => {
            const list = [...r.customers.values()];
            return list.length ? list.map((c, i) => <span key={c.id ?? c.name}>{i > 0 && ", "}<Link href={customerHref(c)} className="link">{c.name}</Link></span>) : dash;
          },
        },
        { key: "tickets", label: "TICKETS", desc: true, sortValue: (r) => r.tickets.length, render: (r) => r.tickets.length },
        { key: "open", label: "OPEN", desc: true, sortValue: (r) => ticketStats(r.tickets).open, render: (r) => ticketStats(r.tickets).open },
        { key: "updated", label: "LAST ACTIVITY", desc: true, sortValue: (r) => time(lastActivity(r.tickets)), render: (r) => ago(lastActivity(r.tickets)) },
      ]}
    />
  );
}

export function AgentsView() {
  const { directory } = useDesk();

  return (
    <DirectoryList
      title="Agents"
      noun="agent"
      subtitle={<>Everyone who is assigned a ticket or has written as an agent. Derived from <code>assignee</code> and event authors.</>}
      placeholder="Search agents…"
      sort="name:asc"
      empty="No agents yet."
      items={[...directory.agents.values()]}
      search={(a) => [a.name, a.id]}
      href={(a) => agentHref(a)}
      columns={[
        { key: "name", label: "AGENT", sortValue: (a) => a.name.toLowerCase(), render: (a) => <PersonCell name={a.name} sub={a.id} /> },
        { key: "assigned", label: "ASSIGNED", desc: true, sortValue: (a) => a.tickets.length, render: (a) => a.tickets.length },
        { key: "open", label: "OPEN", desc: true, sortValue: (a) => agentStats(a).open, render: (a) => agentStats(a).open },
        { key: "replies", label: "PUBLIC REPLIES", desc: true, sortValue: (a) => agentStats(a).publicReplies, render: (a) => agentStats(a).publicReplies },
        { key: "notes", label: "INTERNAL NOTES", desc: true, sortValue: (a) => agentStats(a).notes, render: (a) => agentStats(a).notes },
        { key: "updated", label: "LAST ACTIVITY", desc: true, sortValue: (a) => time(lastActivity(a.tickets)), render: (a) => ago(lastActivity(a.tickets)) },
      ]}
    />
  );
}

const sortedByUpdate = <T extends { updated_at: string }>(list: T[]) => [...list].sort((a, b) => time(b.updated_at) - time(a.updated_at));

export function CustomerDetailView({ id }: { id: string }) {
  const desk = useDesk();

  return (
    <DetailPage
      section="Customers"
      id={id}
      find={(key) => desk.directory.customers.get(key)}
      render={(c, crumbs) => {
        const s = ticketStats(c.tickets);
        const events = desk.events.filter((e) => c.tickets.some((t) => t.id === e.ticket_id));

        return (
          <>
            <PageHeader
              crumbs={crumbs}
              title={c.name}
              subtitle={c.id ? <>Customer ID <code>{c.id}</code></> : undefined}
              actions={<Button variant="outline" render={<Link href={`/tickets?customer=${encodeURIComponent(c.key)}`} />}>View in tickets list</Button>}
            />
            <StatGrid items={[
              { label: "Tickets", value: s.total, note: "All time" },
              { label: "Open", value: s.open, note: "Not yet solved" },
              { label: "Resolved / closed", value: s.resolved, note: s.avg != null ? `Avg. resolution ${formatDuration(s.avg)}` : "Completed tickets" },
              { label: "Requesters", value: c.requesters.size, note: "People at this customer" },
            ]} />
            <Panel title="Requesters" description="People at this customer who raised tickets.">
              <div className="pb-2">
                {c.requesters.size ? [...c.requesters.values()].map((r) => (
                  <Link key={requesterKey(r)} href={requesterHref(r)} className="flex items-center justify-between px-[18px] py-2 hover:bg-hover">
                    <PersonCell name={r.name || r.email || ""} sub={r.email} />
                    <Muted>{plural(c.tickets.filter((t) => requesterKey(t.requester) === requesterKey(r)).length, "ticket")}</Muted>
                  </Link>
                )) : <Empty>No requesters.</Empty>}
              </div>
            </Panel>
            <Panel title="Tickets"><CompactTickets tickets={sortedByUpdate(c.tickets)} empty="No tickets for this customer." /></Panel>
            <Panel title="Recent activity" description="Latest events across this customer's tickets."><RecentEvents events={events} /></Panel>
          </>
        );
      }}
    />
  );
}

export function RequesterDetailView({ id }: { id: string }) {
  const desk = useDesk();

  return (
    <DetailPage
      section="Requesters"
      id={id}
      find={(key) => desk.directory.requesters.get(key)}
      render={(r, crumbs) => {
        const s = ticketStats(r.tickets);
        const comments = r.events.filter((e) => e.type === "comment");

        return (
          <>
            <PageHeader
              crumbs={crumbs}
              title={r.name}
              subtitle={<>{r.email || "No email"}{r.id && <> · ID <code>{r.id}</code></>}</>}
              actions={r.email ? <Button variant="outline" render={<Link href={`/tickets?q=${encodeURIComponent(r.email)}`} />}>View in tickets list</Button> : undefined}
            />
            <StatGrid items={[
              { label: "Tickets", value: s.total, note: "Raised by this person" },
              { label: "Open", value: s.open, note: "Not yet solved" },
              { label: "Resolved / closed", value: s.resolved, note: s.avg != null ? `Avg. resolution ${formatDuration(s.avg)}` : "Completed tickets" },
              { label: "Comments written", value: comments.length, note: "As the requester" },
            ]} />
            <Panel title="Customer">
              <div className="pb-2">
                {r.customers.size ? [...r.customers.values()].map((c) => (
                  <Link key={c.id ?? c.name} href={customerHref(c)} className="block px-[18px] py-2 hover:bg-hover"><PersonCell name={c.name ?? ""} sub={c.id} /></Link>
                )) : <Empty>No customer on these tickets.</Empty>}
              </div>
            </Panel>
            <Panel title="Tickets"><CompactTickets tickets={[...r.tickets].sort(recentFirst)} /></Panel>
            <Panel title="Recent comments" description="Comments this person wrote on their tickets."><RecentEvents events={comments} /></Panel>
          </>
        );
      }}
    />
  );
}

export function AgentDetailView({ id }: { id: string }) {
  const desk = useDesk();

  return (
    <DetailPage
      section="Agents"
      id={id}
      find={(key) => desk.directory.agents.get(key)}
      render={(a, crumbs) => {
        const s = agentStats(a);

        return (
          <>
            <PageHeader
              crumbs={crumbs}
              title={a.name}
              subtitle={<>Agent ID <code>{a.id}</code></>}
              actions={<Button variant="outline" render={<Link href={`/tickets?assignee=${encodeURIComponent(a.id)}`} />}>View in tickets list</Button>}
            />
            <StatGrid items={[
              { label: "Assigned tickets", value: s.total, note: `${s.open} open` },
              { label: "Public replies", value: s.publicReplies, note: "Visible to requesters" },
              { label: "Internal notes", value: s.notes, note: "Agents only" },
              { label: "Status changes", value: s.transitions, note: "Made by this agent" },
            ]} />
            <Panel title="Assigned tickets"><CompactTickets tickets={[...a.tickets].sort(recentFirst)} empty="No tickets are assigned to this agent." /></Panel>
            <Panel title="Recent activity" description="Comments, notes and status changes made by this agent."><RecentEvents events={a.events} /></Panel>
          </>
        );
      }}
    />
  );
}
