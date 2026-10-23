export function nextSort(sort: string, key: string, defaultDir: "asc" | "desc" = "asc"): string {
  const [field, dir] = sort.split(":");
  return field === key ? `${key}:${dir === "asc" ? "desc" : "asc"}` : `${key}:${defaultDir}`;
}

export function SortHeader({
  label,
  field,
  sort,
  onSort,
}: {
  label: string;
  field: string;
  sort: string;
  onSort: (field: string) => void;
}) {
  const [active, dir] = sort.split(":");
  const on = active === field;

  return (
    <th
      className="border-y bg-deep p-0 text-left"
      aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        onClick={() => onSort(field)}
        className={`w-full px-4 py-3 text-left text-nano font-bold tracking-[0.65px] hover:text-white ${on ? "text-[#e1f4ff]" : "text-[#6e7e96]"}`}
      >
        {label}
        <i className="ml-1 text-[8px] not-italic">{on ? (dir === "asc" ? "▲" : "▼") : ""}</i>
      </button>
    </th>
  );
}
