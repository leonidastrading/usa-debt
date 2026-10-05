// AI news digest: condenses the day's headlines into a few lines tied to the regime scores.
// Runs only when ANTHROPIC_API_KEY is set; the result is cached for six hours.
import Anthropic from "@anthropic-ai/sdk";
import { unstable_cache } from "next/cache";
import type { NewsItem } from "./news.ts";

export type Digest = { text: string; model: string; generatedAt: string } | { error: string } | null;

const SYSTEM = `You are a fixed-income strategist writing a morning note for one investor who monitors US Treasury market risk and hedges with SPX put spreads.
From the headlines given, write:
1. "Bottom line:" one sentence on what matters most today for US bond-market stress.
2. Three to five bullets, each one line, each naming the development and why it matters (auctions, fiscal, Fed/liquidity, inflation, global spillover). Skip anything not material.
3. "Watch next:" one line naming scheduled catalysts mentioned in the headlines (auctions, data, Fed, deadlines), or "nothing scheduled in these headlines".
Use only the headlines provided; do not invent numbers. Plain text, no markdown headers.`;

async function generate(headlines: string, regimes: string): Promise<Digest> {
  const client = new Anthropic();
  // `fallbacks: "default"` lets the API re-run a declined request on another model.
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Current regime scores (0-100, higher = more stress):\n${regimes}\n\nHeadlines (newest first):\n${headlines}`,
      },
    ],
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);
  if (res.stop_reason === "refusal") return { error: "The model declined to summarize these headlines." };
  const text = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  return { text, model: res.model, generatedAt: new Date().toISOString() };
}

const cachedGenerate = unstable_cache(generate, ["news-digest-v1"], { revalidate: 6 * 60 * 60 });

export async function getDigest(items: NewsItem[], regimes: { name: string; score: number }[]): Promise<Digest> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const headlines = items
    .slice(0, 60)
    .map((i) => `- [${i.published.slice(0, 10)}] ${i.title} (${i.source})`)
    .join("\n");
  const reg = regimes.map((r) => `${r.name}: ${Math.round(r.score)}`).join("\n");
  try {
    return await cachedGenerate(headlines, reg);
  } catch (err) {
    console.error("[digest]", err);
    return { error: "Digest unavailable right now." };
  }
}
