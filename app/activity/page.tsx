import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityView } from "@/components/desk/views/activity-view";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  // useSearchParams (filters live in the URL) needs a Suspense boundary.
  return (
    <Suspense>
      <ActivityView />
    </Suspense>
  );
}
