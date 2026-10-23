import type { Metadata } from "next";
import { safeDecode } from "@/lib/format";
import { CustomerDetailView } from "@/components/desk/views/directory-views";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  return <CustomerDetailView id={safeDecode(key)} />;
}
