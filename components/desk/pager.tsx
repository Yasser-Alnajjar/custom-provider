import { Button } from "@/components/ui/button";
import { NativeSelect } from "./native-select";

const SIZES = [10, 25, 50, 100];

export function Pager({
  total,
  page,
  size,
  onPage,
  onSize,
}: {
  total: number;
  page: number;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(total, page * size);
  const nums: (number | "…")[] = [];

  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-[18px] py-[11px] text-micro text-[#77869e]">
      <span>{total ? `Showing ${from}–${to} of ${total}` : "No results"}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="mr-2 flex items-center gap-1.5">
          Rows
          <NativeSelect value={size} onChange={(e) => onSize(Number(e.target.value))} className="h-7">
            {SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹ Prev
        </Button>
        {nums.map((n, i) =>
          n === "…" ? (
            <span key={`gap${i}`} className="px-1">
              …
            </span>
          ) : (
            <Button
              key={n}
              variant={n === page ? "default" : "outline"}
              size="sm"
              aria-current={n === page ? "page" : undefined}
              onClick={() => onPage(n)}
            >
              {n}
            </Button>
          ),
        )}
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next ›
        </Button>
      </div>
    </div>
  );
}
