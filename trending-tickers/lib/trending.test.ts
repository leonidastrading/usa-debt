import { test } from "node:test";
import assert from "node:assert/strict";
import { currentEditionDate, latestHeadlines, nyClock, parseRss, pickTop, previousDate, shortName, sourceName, tvSymbol } from "./trending.ts";

test("New York clock handles daylight saving", () => {
  assert.deepEqual(nyClock(new Date("2026-10-09T13:05:00Z")), { date: "2026-10-09", hour: 9, minute: 5 }); // EDT
  assert.deepEqual(nyClock(new Date("2026-12-09T13:05:00Z")), { date: "2026-12-09", hour: 8, minute: 5 }); // EST
});

test("edition switches over at 9 AM New York time", () => {
  assert.equal(currentEditionDate(new Date("2026-10-09T12:59:00Z")), "2026-10-08");
  assert.equal(currentEditionDate(new Date("2026-10-09T13:00:00Z")), "2026-10-09");
  assert.equal(currentEditionDate(new Date("2026-03-01T05:00:00Z")), "2026-02-28");
  assert.equal(previousDate("2026-01-01"), "2025-12-31");
});

test("TradingView symbols", () => {
  assert.equal(tvSymbol("NASDAQ", "ASTS"), "NASDAQ:ASTS");
  assert.equal(tvSymbol("NYSEArca", "GLD"), "AMEX:GLD");
  assert.equal(tvSymbol("NYSE", "BRK.B"), "NYSE:BRK_B");
  assert.equal(tvSymbol("CRYPTO", "BTC.X"), null);
});

test("pickTop skips what TradingView can't chart and re-ranks", () => {
  const top = pickTop(
    [
      { symbol: "BTC.X", exchange: "CRYPTO" },
      { symbol: "ASTS", exchange: "NASDAQ", region: "US", trends: { summary: " why " } },
      { symbol: "T", exchange: "NYSE", region: "US", trends: null },
    ],
    5,
  );
  assert.deepEqual(top.map((t) => [t.rank, t.tvSymbol, t.summary]), [
    [1, "NASDAQ:ASTS", "why"],
    [2, "NYSE:T", ""],
  ]);
});

test("short company names for news search", () => {
  assert.equal(shortName("AT&T Inc"), "AT&T");
  assert.equal(shortName("Verizon Communications Inc."), "Verizon Communications");
  assert.equal(shortName("AST SpaceMobile Inc - Ordinary Shares - Class A"), "AST SpaceMobile");
  assert.equal(shortName("SpaceX"), "SpaceX");
});

test("parseRss strips the source suffix", () => {
  const xml = `<rss><channel><item><title>Big news - Reuters</title><link>https://x</link><pubDate>Thu, 08 Oct 2026 12:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item></channel></rss>`;
  assert.deepEqual(parseRss(xml), [
    { title: "Big news", link: "https://x", source: "Reuters", published: "2026-10-08T12:00:00.000Z" },
  ]);
});

test("headline filler is dropped and the newest come first", () => {
  const h = (title: string, published: string) => ({ title, link: "https://x", source: "", published });
  const out = latestHeadlines([
    h("15,700 Shares in AST SpaceMobile, Inc. $ASTS Bought by REX Advisers LLC", "2026-10-08T20:00:00Z"),
    h("Professional Advisory Services Inc. Lowers Stock Holdings in AT&T Inc.", "2026-10-08T21:00:00Z"),
    h("T-Mobile US, Inc. $TMUS Stock Sold by Overbrook Management Corp", "2026-10-08T21:30:00Z"),
    h("SpaceX Buys Wireless Spectrum For Starlink; Verizon, AT&T, T-Mobile Tumble", "2026-10-08T22:30:00Z"),
    h("AST SpaceMobile Sinks 7% as Satellite Rival Clears Regulatory Hurdle", "2026-10-08T16:43:00Z"),
  ]);
  assert.deepEqual(out.map((x) => x.title), [
    "SpaceX Buys Wireless Spectrum For Starlink; Verizon, AT&T, T-Mobile Tumble",
    "AST SpaceMobile Sinks 7% as Satellite Rival Clears Regulatory Hurdle",
  ]);
  assert.equal(sourceName("https://finance.yahoo.com/news/x.html"), "Yahoo Finance");
  assert.equal(sourceName("https://www.example.com/a"), "example.com");
});
