import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthBanner } from "@/components/desk/auth-banner";
import { DeskDataProvider } from "@/components/desk/data-provider";
import { Sidebar } from "@/components/desk/sidebar";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "Acme Desk — Custom Provider Lab",
    template: "%s — Acme Desk",
  },
  description:
    "Mock ticketing provider for testing Elapsed's Custom Ticket Provider integration.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <DeskDataProvider>
          <Sidebar />
          <main className="ml-[205px] max-w-[1500px] px-5 py-[22px] max-md:ml-[58px] max-md:px-3 max-md:py-5">
            <AuthBanner />
            {children}
            <footer className="px-0.5 pt-[21px] pb-[5px] text-nano tracking-[0.8px] text-[#5f6e85]">
              ACME DESK DEMO <span className="px-1.5 text-[#3b8bb6]">•</span>{" "}
              Built for Elapsed custom-provider testing
              <span className="float-right tracking-normal text-[#65748a] max-md:float-none max-md:block">
                Not a production ticketing system
              </span>
            </footer>
          </main>
        </DeskDataProvider>
        <Toaster />
      </body>
    </html>
  );
}
