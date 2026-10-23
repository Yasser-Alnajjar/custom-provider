import type { Metadata } from "next";
import { safeDecode } from "@/lib/format";
import { TicketView } from "@/components/desk/views/ticket-view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;

  return { title: safeDecode(id) };
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <TicketView key={id} id={safeDecode(id)} />;
}
