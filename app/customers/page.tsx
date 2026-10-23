import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomersView } from "@/components/desk/views/directory-views";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <Suspense>
      <CustomersView />
    </Suspense>
  );
}
