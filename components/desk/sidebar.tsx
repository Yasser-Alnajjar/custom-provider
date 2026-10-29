"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActor } from "@/lib/client/storage";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDesk } from "./data-provider";

const NAV = [
  { label: "DESK", items: [
    { href: "/", icon: "▦", text: "Overview" },
    { href: "/tickets", icon: "☰", text: "Tickets", count: true },
    { href: "/activity", icon: "↻", text: "Activity" },
  ] },
  { label: "PEOPLE", items: [
    { href: "/customers", icon: "⌂", text: "Customers" },
    { href: "/requesters", icon: "☺", text: "Requesters" },
    { href: "/agents", icon: "✦", text: "Agents" },
  ] },
  { label: "INTEGRATION", items: [
    { href: "/provider", icon: "⚙", text: "Provider" },
    { href: "/generator", icon: "✚", text: "Data generator" },
  ] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { online, ticketsState, tickets } = useDesk();
  const actor = useActor();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="fixed inset-y-0 left-0 flex w-[205px] flex-col border-r bg-sidebar px-3.5 py-[22px] max-md:w-[58px] max-md:px-[7px] max-md:py-4">
      <div className="flex items-center gap-2.5 px-2 pb-[27px] max-md:px-1">
        <div className="grid size-[34px] place-items-center rounded-[10px] bg-brand text-[19px] font-extrabold text-white">A</div>
        <div className="max-md:hidden">
          <b className="block text-[13px]">Acme Desk</b>
          <small className="text-nano tracking-[0.8px] text-[#6e7e96]">CUSTOM PROVIDER</small>
        </div>
      </div>
      <div className="mb-3 px-2 max-md:hidden">
        <span className={cn("inline-flex items-center gap-1.5 text-micro", online ? "text-ok" : "text-bad")}>
          <i className="size-1.5 rounded-full bg-current" />
          {online ? "API online" : "API unreachable"}
        </span>
      </div>
      <nav aria-label="Main">
        {NAV.map((group) => (
          <div key={group.label}>
            <div className="mt-4 mb-1.5 px-2 text-nano font-bold tracking-[0.8px] text-[#56647c] max-md:hidden">{group.label}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active(item.href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-body text-[#9eacc1] hover:bg-hover hover:text-white max-md:justify-center",
                  active(item.href) && "bg-[#12263b] text-[#e1f4ff]",
                )}
              >
                <span aria-hidden>{item.icon}</span>
                <span className="max-md:hidden">{item.text}</span>
                {item.count && ticketsState === "ready" && (
                  <em className="ml-auto rounded-full bg-[#162338] px-1.5 text-nano not-italic text-[#8fa3c4] max-md:hidden">{tickets.length}</em>
                )}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <Link
        href="/provider#identity"
        title="Change the identity used for comments"
        className="mt-auto flex items-center gap-2.5 border-t px-[5px] pt-[18px] max-md:justify-center max-md:pt-3.5"
      >
        <div className="grid size-[31px] shrink-0 place-items-center rounded-full bg-[#27344c] text-micro font-bold text-[#b8d9ff]">{initials(actor.name)}</div>
        <div className="max-md:hidden">
          <b className="text-small">{actor.name}</b>
          <small className="mt-[3px] block text-micro text-[#77839a]">Acting as agent</small>
        </div>
      </Link>
    </aside>
  );
}
