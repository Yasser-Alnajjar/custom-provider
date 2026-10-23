import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function Panel({
  title,
  description,
  action,
  children,
  className,
  id,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("mb-4 overflow-hidden rounded-[10px] border bg-card", className)}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-[18px] pt-4 pb-3">
          <div>
            <h2 className="text-[13px] font-bold text-[#f4f7fc]">{title}</h2>
            {description && <p className="mt-1 text-micro text-[#78869d]">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-5 py-10 text-center text-small text-[#78869d]", className)}>{children}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Empty className="text-bad">
      {message}
      {onRetry && (
        <>
          <br />
          <Button variant="link" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </>
      )}
    </Empty>
  );
}

export function Notice({ children, tone = "warn" }: { children: React.ReactNode; tone?: "warn" | "subtle" }) {
  return (
    <div
      className={cn(
        "mx-[18px] mb-3 rounded-lg border px-3 py-2 text-micro",
        tone === "warn" ? "border-warn/30 bg-warn-bg text-warn" : "border-border bg-deep text-[#8794aa]",
      )}
    >
      {children}
    </div>
  );
}

export function StatGrid({ items }: { items: { label: string; value: React.ReactNode; note?: string; tone?: "blue" | "amber" | "green"; href?: string }[] }) {
  const tones = { blue: "text-[#4ebaff]", amber: "text-[#f3b64b]", green: "text-[#35c992]" };

  return (
    <section className="mb-4 grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
      {items.map((s) => {
        const body = (
          <>
            <div className="flex justify-between text-small text-[#9aa7bc]">
              {s.label}
              {s.tone && <span className={tones[s.tone]}>●</span>}
            </div>
            <strong className="mt-[13px] mb-[5px] block text-[26px] tracking-[-0.7px] text-[#f2f5fb]">{s.value}</strong>
            <small className="text-micro text-[#78869d]">{s.note}</small>
          </>
        );
        const cls = "block rounded-[10px] border bg-card p-[13px]";

        return s.href ? (
          <Link key={s.label} href={s.href} className={cn(cls, "hover:border-[#2f6f9a]")}>
            {body}
          </Link>
        ) : (
          <div key={s.label} className={cls}>
            {body}
          </div>
        );
      })}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border bg-deep p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.key}
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-md px-2.5 py-1 text-micro text-[#8794aa]",
            value === o.key && "bg-[#162338] text-[#e1f4ff]",
          )}
        >
          {o.label}
          {o.count != null && <i className="ml-1 text-[#6e7e96] not-italic">{o.count}</i>}
        </button>
      ))}
    </div>
  );
}
