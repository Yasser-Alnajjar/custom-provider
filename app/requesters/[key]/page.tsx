import type { Metadata } from "next";
import { safeDecode } from "@/lib/format";
import { RequesterDetailView } from "@/components/desk/views/directory-views";

export const metadata: Metadata = { title: "Requester" };

export default async function RequesterPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  return <RequesterDetailView id={safeDecode(key)} />;
}
