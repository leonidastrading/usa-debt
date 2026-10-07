import { revalidatePath } from "next/cache";

// Called by Vercel Cron at 23:30 UTC on weekdays, after Treasury posts the day's yields (see vercel.json) so the dashboard picks up
// the day's data without waiting for the 6-hour cache to expire.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  revalidatePath("/", "layout");
  return Response.json({ revalidated: true, at: new Date().toISOString() });
}
