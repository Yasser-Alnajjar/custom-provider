import Link from "next/link";

interface Crumb {
  label: string;
  href: string;
}

export function PageHeader({
  crumbs = [],
  title,
  badge,
  subtitle,
  actions,
}: {
  crumbs?: Crumb[];
  title: string;
  badge?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-[23px] flex items-start justify-between gap-5 max-md:block">
      <div>
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-[13px] text-small text-[#7f8ca3]">
            {crumbs.map((c) => (
              <span key={c.href}>
                <Link href={c.href} className="text-[#8fa0ba] hover:underline">
                  {c.label}
                </Link>
                <span className="px-2 text-[#46546b]">/</span>
              </span>
            ))}
            <b className="font-semibold">{title}</b>
          </nav>
        )}
        <h1 className="text-2xl font-bold tracking-[-0.7px] text-[#f4f7fc] max-md:text-xl">
          {title}
          {badge}
        </h1>
        {subtitle && <p className="mt-2 text-body text-[#8794aa] max-md:leading-normal">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2 pt-2.5 max-md:pt-4">{actions}</div>}
    </header>
  );
}
