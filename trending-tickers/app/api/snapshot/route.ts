import { EDITION_HOUR, nyClock } from "@/lib/trending";
import { getEdition } from "@/lib/edition";

export const dynamic = "force-dynamic";

// Called by Vercel Cron at 13:00 and 14:00 UTC (see vercel.json): one of the two is 9 AM in New
// York whether daylight saving is on or not. Before 9 it does nothing; after 9 the first call
// builds today's edition and the second finds it already cached.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const ny = nyClock();
  if (ny.hour < EDITION_HOUR) {
    return Response.json({ skipped: `before ${EDITION_HOUR} AM in New York`, ny });
  }
  const edition = await getEdition(ny.date);
  return Response.json({
    date: edition.date,
    capturedAt: edition.capturedAt,
    tickers: edition.tickers.map((t) => t.symbol),
  });
}
