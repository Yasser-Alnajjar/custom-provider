import type { Metadata } from "next";
import { GeneratorView } from "@/components/desk/views/generator-view";

export const metadata: Metadata = { title: "Data generator" };

export default function GeneratorPage() {
  return <GeneratorView />;
}
