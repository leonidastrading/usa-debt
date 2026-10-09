import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trending Five",
  description: "Every morning at 9 AM ET: the top 5 trending tickers on Stocktwits, with live charts and why each one is trending.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="wrap">{children}</main>
        <footer className="footer">
          <div className="wrap">
            Trending list and summaries: Stocktwits. Headlines: Google News. Charts: TradingView. Refreshed daily at 9 AM New
            York time. Not investment advice.
          </div>
        </footer>
      </body>
    </html>
  );
}
