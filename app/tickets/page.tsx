import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketsView } from "@/components/desk/views/tickets-view";

export const metadata: Metadata = { title: "Tickets" };

export default function TicketsPage() {
  // useSearchParams (filters live in the URL) needs a Suspense boundary.
  return (
    <Suspense>
      <TicketsView />
    </Suspense>
  );
}
