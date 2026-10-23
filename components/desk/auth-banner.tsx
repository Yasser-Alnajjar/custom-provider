"use client";

import Link from "next/link";
import { useDesk } from "./data-provider";

export function AuthBanner() {
  const { unauthorized } = useDesk();

  if (!unauthorized) return null;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-bad/30 bg-bad-bg px-3.5 py-2.5 text-small text-bad">
      The server rejected the API token (401).{" "}
      <Link href="/provider" className="underline">
        Update the token
      </Link>{" "}
      to continue.
    </div>
  );
}
