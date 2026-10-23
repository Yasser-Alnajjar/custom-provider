import type { Metadata } from "next";
import { ProviderView } from "@/components/desk/views/provider-view";

export const metadata: Metadata = { title: "Provider" };

export default function ProviderPage() {
  return <ProviderView />;
}
