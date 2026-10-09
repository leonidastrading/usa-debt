# Trending Five

Every morning at 9 AM New York time, this app takes the top 5 tickers from
[Stocktwits' trending list](https://stocktwits.com/sentiment) and shows them one after another, each with:

- a live, interactive TradingView chart (5 days of 15-minute bars to start; change the range on the chart),
- Stocktwits' summary of why it's trending,
- the three latest headlines about it from Yahoo Finance (Google News as a fallback).

## How the 9 AM list works

- `/api/snapshot` is called by Vercel Cron at 13:00 and 14:00 UTC (`vercel.json`). One of those is 9 AM in New York
  whether daylight saving is on or not. Before 9 AM New York time the call does nothing; the first call after 9 builds
  the day's list.
- The list is kept in Vercel's data cache under that date, so it stays fixed for the day. Before 9 AM the page shows
  yesterday's list.
- If the cron hasn't run yet (on the Hobby plan it can fire any time within the hour), the first visitor after 9 AM
  builds the list instead. The page always shows the exact time the list was taken.

Only US-listed stocks and ETFs that TradingView can chart are included. Crypto is skipped.

## Deploy

No API keys needed. Optional: set `CRON_SECRET` to protect `/api/snapshot` (Vercel Cron sends it automatically).

## Local development

```bash
npm install
npm run dev     # http://localhost:3000
npm test
npm run typecheck
```
