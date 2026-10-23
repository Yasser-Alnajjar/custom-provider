"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Empty, Panel } from "@/components/desk/panel";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Panel>
      <Empty className="text-bad">
        Something went wrong rendering this page: {error.message}<br />
        <Button variant="link" size="sm" onClick={reset}>Try again</Button>
        {" · "}
        <Link href="/" className="link">Back to overview</Link>
      </Empty>
    </Panel>
  );
}
