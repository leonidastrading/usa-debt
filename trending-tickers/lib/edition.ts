// Each day's edition is built once — by the 9 AM cron, or by the first visitor after 9 AM if the
// cron hasn't run — and then served from Vercel's data cache, so the list stays as it was at 9.
import { unstable_cache } from "next/cache";
import { buildEdition } from "./build.ts";
import type { Edition } from "./trending.ts";

export const getEdition: (date: string) => Promise<Edition> = unstable_cache(buildEdition, ["edition-v3"], {
  revalidate: 60 * 60 * 48,
});
