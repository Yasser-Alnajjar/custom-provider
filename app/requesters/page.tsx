import type { Metadata } from "next";
import { Suspense } from "react";
import { RequestersView } from "@/components/desk/views/directory-views";

export const metadata: Metadata = { title: "Requesters" };

export default function RequestersPage() {
  return (
    <Suspense>
      <RequestersView />
    </Suspense>
  );
}
