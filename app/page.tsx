import type { Metadata } from "next";
import { OverviewView } from "@/components/desk/views/overview-view";

export const metadata: Metadata = { title: { absolute: "Acme Desk — Custom Provider Lab" } };

export default function OverviewPage() {
  return <OverviewView />;
}
