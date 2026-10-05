import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Treasury Risk Monitor",
  description: "Early-warning dashboard for US bond-market stress: regime scores, debt rollover scenarios, a hedging playbook and a news digest.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="wrap">
            <Link href="/" className="brand"><span className="brand-mark">UST</span>Treasury Risk Monitor</Link>
            <Nav />
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="footer">
          <div className="wrap">
            Data: FRED (St. Louis Fed), U.S. Treasury FiscalData, Federal Reserve Board, Google News. End-of-day data, refreshed every few hours.
            This is a monitoring tool, not investment advice; scores describe conditions, they do not predict them.
          </div>
        </footer>
      </body>
    </html>
  );
}
