import type { Metadata } from "next";
import { ConfigBuilderView } from "@/components/config-builder/builder-view";

export const metadata: Metadata = { title: "Config builder" };

export default function ConfigBuilderPage() {
  return <ConfigBuilderView />;
}
