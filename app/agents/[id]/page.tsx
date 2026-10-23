import type { Metadata } from "next";
import { safeDecode } from "@/lib/format";
import { AgentDetailView } from "@/components/desk/views/directory-views";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <AgentDetailView id={safeDecode(id)} />;
}
