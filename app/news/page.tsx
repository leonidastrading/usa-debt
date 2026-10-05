import NewsList from "@/components/NewsList";
import { getMarket } from "@/lib/data";
import { getDigest } from "@/lib/digest";
import { dateLabel } from "@/lib/format";
import { getNews, TOPICS } from "@/lib/news";

export const revalidate = 10800;
export const metadata = { title: "News · Treasury Risk Monitor" };

export default async function NewsPage() {
  const [{ items, errors }, market] = await Promise.all([getNews(), getMarket()]);
  const digest = await getDigest(items, market.regimes.regimes.map((r) => ({ name: r.name, score: r.score })));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>News</h1>
          <p>Auctions, debt and deficits, the Fed and global bond markets from the last seven days, plus Federal Reserve press releases.</p>
        </div>
      </div>

      <div className="card">
        <h2>Daily digest</h2>
        {digest == null && (
          <p className="small muted" style={{ marginTop: 6 }}>
            Set <code>ANTHROPIC_API_KEY</code> in your Vercel project to get a short AI-written summary of these headlines, tied to today's regime scores.
          </p>
        )}
        {digest && "error" in digest && <p className="small muted" style={{ marginTop: 6 }}>{digest.error}</p>}
        {digest && "text" in digest && (
          <>
            <div className="digest" style={{ marginTop: 8 }}>{digest.text}</div>
            <p className="small muted" style={{ marginTop: 8 }}>Generated {dateLabel(digest.generatedAt)} by {digest.model} from the headlines below. Check the sources before acting.</p>
          </>
        )}
      </div>

      {errors.length > 0 && <p className="small muted" style={{ marginTop: 12 }}>Could not load: {errors.join(", ")}.</p>}

      <div className="section">
        <NewsList items={items} topics={TOPICS.map((t) => ({ id: t.id, label: t.label }))} />
      </div>
    </>
  );
}
