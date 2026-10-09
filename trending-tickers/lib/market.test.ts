import { test } from "node:test";
import assert from "node:assert/strict";
import { marketScore, pickMarketStories } from "./market.ts";

const now = Date.parse("2026-10-09T13:00:00Z");
const story = (title: string, hoursAgo: number, summary = "") => ({
  title,
  summary,
  link: `https://x/${encodeURIComponent(title)}`,
  source: "CNBC",
  published: new Date(now - hoursAgo * 3_600_000).toISOString(),
});

test("market-wide stories outscore single-company and off-topic ones", () => {
  assert.ok(marketScore(story("Stock futures are little changed after OpenAI revenue report", 1)) >= 4);
  assert.ok(marketScore(story("Treasury yields are 'really, really high' but can come down soon", 1)) >= 4);
  assert.ok(marketScore(story("Major League Baseball proposes shortening its regular season", 1)) < 4);
  assert.equal(marketScore(story("Stocks making the biggest moves premarket: Broadcom, Palantir", 1)), 0);
  // A company story scores low even with a market word in its summary.
  assert.ok(marketScore(story("Why a Starbucks takeover of Chipotle would make sense", 1, "Shares rose.")) < 4);
});

test("picks three recent market stories, newest first, without duplicates", () => {
  const picked = pickMarketStories(
    [
      story("Nasdaq falls 1% as AI trade stumbles", 16),
      story("Stock futures are little changed after tech sector turmoil", 4),
      story("Stock futures are little changed after tech sector turmoil", 3),
      story("Fed officials see another rate hike coming, minutes show", 30),
      story("Inflation on many everyday items was due to tariffs, NY Fed says", 19),
      story("Trump says U.S. will not attack Iran before midterm election", 2),
    ],
    now,
  );
  assert.deepEqual(picked.map((s) => s.title), [
    "Stock futures are little changed after tech sector turmoil",
    "Nasdaq falls 1% as AI trade stumbles",
    "Inflation on many everyday items was due to tariffs, NY Fed says",
  ]);
});
