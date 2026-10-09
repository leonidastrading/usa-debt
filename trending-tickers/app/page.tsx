import TradingViewChart from "@/components/TradingViewChart";
import { getEdition } from "@/lib/edition";
import { currentEditionDate, type Edition, type Ticker } from "@/lib/trending";

export const dynamic = "force-dynamic";

const fmtDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

const fmtAgo = (iso: string, now: number) => {
  const h = Math.round((now - Date.parse(iso)) / 3_600_000);
  if (!Number.isFinite(h)) return "";
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

const fmtCount = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export default async function Page() {
  const date = currentEditionDate();
  let edition: Edition | null = null;
  let error = "";
  try {
    edition = await getEdition(date);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <header className="masthead">
        <p className="eyebrow">Trending Five · {fmtDate(date)}</p>
        <h1>The 5 most-talked-about tickers this morning</h1>
        <p className="lede">
          The top of{" "}
          <a href="https://stocktwits.com/sentiment" target="_blank" rel="noreferrer">
            Stocktwits&rsquo; trending list
          </a>{" "}
          {edition ? <>as of {fmtTime(edition.capturedAt)} ET</> : "at 9 AM ET"}, with a live chart and why each one is
          trending. A new list arrives at 9 AM New York time every day.
        </p>
        {edition && (
          <nav className="jump" aria-label="Tickers">
            {edition.tickers.map((t) => (
              <a key={t.symbol} href={`#${t.symbol}`}>
                <span className="jump-rank">{t.rank}</span>
                {t.symbol}
              </a>
            ))}
          </nav>
        )}
      </header>

      {error && (
        <div className="error">
          Couldn&rsquo;t load the trending list from Stocktwits ({error}). Try again in a minute.
        </div>
      )}

      {edition?.tickers.map((t) => <TickerCard key={t.symbol} t={t} now={Date.parse(edition.capturedAt)} />)}
    </>
  );
}

function TickerCard({ t, now }: { t: Ticker; now: number }) {
  return (
    <section id={t.symbol} className="card">
      <div className="card-head">
        <span className="rank">#{t.rank}</span>
        {t.logo && <img className="logo" src={t.logo} alt="" width={40} height={40} />}
        <div className="title">
          <h2>
            <a href={`https://stocktwits.com/symbol/${t.symbol}`} target="_blank" rel="noreferrer">
              {t.symbol}
            </a>
          </h2>
          <p className="name">{t.name}</p>
        </div>
        <dl className="facts">
          <div>
            <dt>Exchange</dt>
            <dd>{t.exchange}</dd>
          </div>
          {t.sector && (
            <div>
              <dt>Sector</dt>
              <dd>{t.sector}</dd>
            </div>
          )}
          <div>
            <dt>Watchers</dt>
            <dd>{fmtCount(t.watchers)}</dd>
          </div>
        </dl>
      </div>

      <TradingViewChart symbol={t.tvSymbol} />

      <div className="why">
        <h3>Why it&rsquo;s trending</h3>
        {t.summary ? (
          <p>{t.summary}</p>
        ) : (
          <p className="muted">Stocktwits hasn&rsquo;t posted a summary for {t.symbol} yet. See the headlines below.</p>
        )}
        {t.headlines.length > 0 && (
          <ul className="headlines">
            {t.headlines.map((h) => (
              <li key={h.link}>
                <a href={h.link} target="_blank" rel="noreferrer">
                  {h.title}
                </a>
                <span className="meta">
                  {h.source}
                  {h.published && <> · {fmtAgo(h.published, now)}</>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
