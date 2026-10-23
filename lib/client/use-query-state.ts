"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Scalar = string | number;

/**
 * List filters, sort and page live in the query string so a refresh or a shared
 * link restores them. Values equal to their default are omitted from the URL.
 */
export function useQueryState<T extends Record<string, Scalar>>(defaults: T) {
  const params = useSearchParams();
  const pathname = usePathname();

  const state = useMemo(() => {
    const out: Record<string, Scalar> = {};

    for (const [key, fallback] of Object.entries(defaults)) {
      const raw = params.get(key);

      if (raw === null) out[key] = fallback;
      else if (typeof fallback === "number") out[key] = Number(raw) || fallback;
      else out[key] = raw;
    }

    return out as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const update = useCallback(
    (patch: Partial<T>) => {
      const next = { ...state, ...patch };
      const q = new URLSearchParams();

      for (const [key, value] of Object.entries(next)) {
        if (value !== "" && String(value) !== String(defaults[key])) q.set(key, String(value));
      }

      const qs = q.toString();
      window.history.replaceState(window.history.state, "", pathname + (qs ? `?${qs}` : "") + window.location.hash);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, pathname],
  );

  return [state, update] as const;
}
