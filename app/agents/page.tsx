import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentsView } from "@/components/desk/views/directory-views";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return (
    <Suspense>
      <AgentsView />
    </Suspense>
  );
}
