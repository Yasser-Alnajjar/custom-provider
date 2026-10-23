"use client";

import { useEffect, useState } from "react";
import { absoluteDate, humanize, relativeTime } from "@/lib/format";

/** Relative timestamp that stays fresh without refetching. */
export function Time({ value }: { value?: string | null }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Before mount, show the absolute date so server and client markup agree.
  const text = now === null ? absoluteDate(value) || "—" : humanize(relativeTime(value, now));

  return (
    <time dateTime={value ?? undefined} title={absoluteDate(value)} suppressHydrationWarning>
      {text}
    </time>
  );
}
