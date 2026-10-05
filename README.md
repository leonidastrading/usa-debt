# Treasury Risk Monitor

An early-warning and decision tool for US bond-market stress. It doesn't forecast. It shows stress building, tells you which regime you're in, and shows the response you decided on ahead of time.

## What's in it

| Page | What it does |
|---|---|
| **Dashboard** (`/`) | Four regime scores (fiscal stress, liquidity stress, inflation scare, growth scare) on a 0–100 scale. Each has a "why this score" breakdown. Also: regime history with past stress events marked; separate TradingView charts of Treasury bond prices (or yields) for the 2Y/10Y/30Y, total federal debt since 2006, and trailing 12-month interest payments; a calibration table, 13 risk indicators with sparklines, and Treasury auction demand (bid-to-cover, indirect share, upcoming auctions). |
| **Scenarios** (`/scenarios`) | **Debt rollover**: rolls the actual marketable-debt maturity schedule (MSPD) through six preset rate scenarios plus one you define, and projects interest cost, interest/GDP and debt/GDP over 10 years. **Hedge stress test**: Black–Scholes stress grid and regime-shaped shocks for your SPX option legs (default sample: a 95/85 put spread). |
| **Playbook** (`/playbook`) | For each regime, write your actions and set a trigger threshold. When a score crosses it, the dashboard shows those actions. |
| **News** (`/news`) | Headlines from the last 7 days on auctions, yields, debt and deficits, the Fed and global bonds, plus Fed press releases. With an API key you also get an AI digest. |
| **Method** (`/method`) | How every score is built, its weights, the proxies used and the known gaps. |

## Data sources (all free)

- **FRED**: Treasury yields, 10Y breakeven, 10Y real yield, Kim–Wright term premium, broad dollar, SOFR, IORB, reverse repo, TGA, Baa and high-yield spreads, VIX, S&P 500, GDP
- **Treasury FiscalData**: auction results and schedule, debt to the penny (daily debt history), monthly interest expense, average interest rates, the maturity detail behind the rollover model (MSPD table 3)
- **News**: Google News RSS searches and the Federal Reserve press-release feed

Data is end-of-day. Pages are cached for 6 hours (news for 3), and a Vercel Cron job refreshes everything after the US close on weekdays.

## Deploy on Vercel

1. Import this repo in Vercel. It's detected as Next.js automatically; no build settings needed.
2. Optional environment variables (see `.env.example`):
   - `FRED_API_KEY`: recommended. Without it the app uses FRED's public CSV endpoint, which throttles bursts and may block cloud IPs. [Get a free key](https://fred.stlouisfed.org/docs/api/api_key.html).
   - `ANTHROPIC_API_KEY`: turns on the AI news digest.
   - `CRON_SECRET`: protects `/api/refresh`. Vercel Cron sends it automatically.
3. Deploy.

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # model unit tests
npm run typecheck
```

## Caveats

- **MOVE index** is paid. The app uses the 10Y yield's realized 20-day volatility as a proxy.
- **Auction tails** need when-issued yields. The app compares the auction's high yield with that day's closing yield, which is noisy.
- **Scores** are z-scores against a trailing 3-year window, so they measure how unusual conditions are, not absolute levels.
- **Rollover model** covers marketable debt only. It ignores TIPS accrual and Fed remittances, so read the gaps between scenarios, not the exact levels.
- **Not investment advice.**
