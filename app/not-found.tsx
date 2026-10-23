import Link from "next/link";
import { PageHeader } from "@/components/desk/page-header";
import { Empty, Panel } from "@/components/desk/panel";

export default function NotFound() {
  return (
    <>
      <PageHeader crumbs={[{ label: "Overview", href: "/" }]} title="Page not found" />
      <Panel>
        <Empty className="text-bad">
          There is no page at this address.<br />
          <Link href="/" className="link">Back to overview</Link>
        </Empty>
      </Panel>
    </>
  );
}
