// Per-regime playbooks: what you decided in advance to do when a regime score crosses your threshold.
// Stored in the browser (localStorage); defaults below are a starting point to edit.

export type PlaybookEntry = { threshold: number; actions: string };
export type Playbook = Record<string, PlaybookEntry>;

export const PLAYBOOK_KEY = "ust-monitor:playbook:v1";

export const DEFAULT_PLAYBOOK: Playbook = {
  fiscal: {
    threshold: 85,
    actions: [
      "Do not count on long Treasuries as a hedge: in this regime stocks and bonds can fall together.",
      "Keep fixed income short (T-bills, < 2Y); no new long-duration buying until the score is back under 70.",
      "Top up SPX put spread coverage to the target hedge ratio; prefer 3–6 month expiries.",
      "Consider dollar-weakness hedges (gold, non-USD assets) for part of the cash pile.",
      "Watch the next 10Y/30Y auctions and the quarterly refunding statement for weak demand.",
    ].join("\n"),
  },
  liquidity: {
    threshold: 85,
    actions: [
      "Cut gross exposure and leverage first; correlations go to 1 in a dash for cash.",
      "Keep margin cash in T-bills; avoid anything you could not sell in a day.",
      "Monetize part of the hedges (e.g. one third) if VIX closes above 35; do not sell them all into the first spike.",
      "Watch for Fed backstops (standing repo usage, swap lines, emergency facilities) as the turning point.",
    ].join("\n"),
  },
  inflation: {
    threshold: 85,
    actions: [
      "Bonds will not hedge equities here; rely on options and cash.",
      "Prefer TIPS and short duration over nominal long bonds.",
      "Reduce any short-premium positions; vol of both stocks and rates tends to rise together.",
    ].join("\n"),
  },
  growth: {
    threshold: 85,
    actions: [
      "Hedges should be paying: take profits on put spreads in stages (e.g. at 50% and 100% of max value).",
      "Long Treasuries work as a hedge in this regime; duration can be added.",
      "After a 10%+ drawdown, roll strikes down rather than adding at the old levels.",
    ].join("\n"),
  },
};

export function loadPlaybook(): Playbook {
  try {
    const raw = localStorage.getItem(PLAYBOOK_KEY);
    if (!raw) return DEFAULT_PLAYBOOK;
    return { ...DEFAULT_PLAYBOOK, ...(JSON.parse(raw) as Playbook) };
  } catch {
    return DEFAULT_PLAYBOOK;
  }
}

export function savePlaybook(p: Playbook) {
  try {
    localStorage.setItem(PLAYBOOK_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable (private mode): edits last for this page view only
  }
}
