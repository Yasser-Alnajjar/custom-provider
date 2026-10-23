import { cn } from "@/lib/utils";

/** A styled native select: keeps form submission, keyboard and mobile behaviour for free. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 max-w-full rounded-lg border border-input bg-[#0d1524] px-2 text-small text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
        className,
      )}
      {...props}
    />
  );
}
