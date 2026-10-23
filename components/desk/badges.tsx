import Link from "next/link";
import { humanize, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  new: "bg-[#232c3d] text-[#aab6c9]",
  open: "bg-[#132c42] text-[#6dc8ff]",
  in_progress: "bg-[#2c2341] text-[#c7a5ff]",
  pending: "bg-warn-bg text-warn",
  solved: "bg-ok-bg text-ok",
  closed: "bg-ok-bg text-ok",
};

export const STATUS_BAR: Record<string, string> = {
  open: "bg-[#3b9fe0]",
  in_progress: "bg-[#9b78e8]",
  pending: "bg-[#d9a441]",
  solved: "bg-[#3fbf8d]",
  closed: "bg-[#3fbf8d]",
};

const PRIORITY_STYLE: Record<string, string> = {
  urgent: "text-[#ff7b8b]",
  high: "text-[#ffb16e]",
  normal: "text-[#bdc8d9]",
  low: "text-[#7ccea9]",
};

const ROLE_STYLE: Record<string, string> = {
  customer: "bg-[#1d2a33] text-[#8ccbe0]",
  agent: "bg-[#1c2c46] text-[#85b4f0]",
  system: "bg-[#262b36] text-[#8d98ab]",
};

export function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-micro text-[#6e7e96]">{children}</span>;
}

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <Muted>—</Muted>;
  return (
    <span
      className={cn(
        "inline-block rounded-[5px] px-[7px] py-[5px] text-nano capitalize",
        STATUS_STYLE[status] ?? STATUS_STYLE.new,
      )}
    >
      {humanize(status)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority?: string | null }) {
  if (!priority) return <Muted>—</Muted>;
  return (
    <span className={cn("text-micro capitalize", PRIORITY_STYLE[priority] ?? "text-[#bdc8d9]")}>
      ● &nbsp;{priority}
    </span>
  );
}

export function RoleBadge({ role }: { role?: string | null }) {
  if (!role) return null;
  return (
    <span
      className={cn(
        "inline-block rounded px-[5px] py-0.5 align-[1px] text-[8px] tracking-[0.5px] uppercase",
        ROLE_STYLE[role] ?? "bg-[#1b2740] text-[#8fa3c4]",
      )}
    >
      {humanize(role)}
    </span>
  );
}

export function Avatar({ name, large }: { name: string; large?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-[#27344c] font-bold text-[#b8d9ff]",
        large ? "size-8 text-small" : "size-6 text-nano",
      )}
    >
      {initials(name)}
    </div>
  );
}

export function Chip({ children, href }: { children: React.ReactNode; href?: string }) {
  const cls =
    "inline-block rounded-full border border-[#2b3a52] bg-[#162338] px-[9px] py-[3px] text-micro text-[#9cb2cc]";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-[#3986b5] hover:text-[#e1f4ff]")}>
      {children}
    </Link>
  ) : (
    <span className={cls}>{children}</span>
  );
}
