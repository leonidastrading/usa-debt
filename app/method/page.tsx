import { FEATURES, REGIMES, Z_WINDOW } from "@/lib/regimes";
import { REGIME_COLORS } from "@/lib/format";

export const metadata = { title: "Method · Treasury Risk Monitor" };

export default function Method() {
  return (
    <div className="prose" style={{ maxWidth: 820 }}>
      <div className="page-head"><div><h1>How it works</h1><p>Everything here is transparent on purpose: when a score flashes you should be able to see exactly why.</p></div></div>

      <h2>What this is (and is not)</h2>
      <p>
        An early-warning and decision tool. Nobody can reliably predict when a bond market breaks; what you can do is see stress building,
        know which regime you are in, and have your response decided before the bad day arrives. The scores describe conditions; they do not forecast them.
      </p>

      <h2>Regime scores</h2>
      <p>
        Each feature below is converted to a trailing z-score: how unusual today's value is compared with the previous {Z_WINDOW} trading days (about three years).
        Only past data is used at each point, so the history chart is an honest backtest. A regime's composite is the weighted average of its features' z-scores
        (clipped at ±4), and the composite is mapped to 0–100 with a normal curve: 50 is a typical day, 84 is one standard deviation, 98 is two.
      </p>
      {REGIMES.map((r) => (
        <div key={r.id} className="card" style={{ marginTop: 12 }}>
          <div className="regime-name"><span className="swatch" style={{ background: REGIME_COLORS[r.id] }} /><h3>{r.name}</h3></div>
          <p className="small ink2" style={{ margin: "4px 0 8px" }}>{r.description}</p>
          <table className="data">
            <thead><tr><th>Feature</th><th className="r">Weight</th></tr></thead>
            <tbody>
              {r.weights.map((w) => (
                <tr key={w.feature}><td>{FEATURES.find((f) => f.id === w.feature)?.label}</td><td className="r">{w.w > 0 ? "+" : "−"}{Math.abs(w.w)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <h2>Calibration</h2>
      <p>
        The dashboard lists past stress episodes (Lehman, the 2011 downgrade, the taper tantrum, the 2019 repo spike, March 2020, the 2022 gilt crisis, SVB,
        October 2023, April 2025) with each regime's peak score around them. Thresholds are worth tuning so the right regime would have fired at those moments
        and stayed quiet otherwise. The "alert rate" under each score's detail shows how often it has been ≥95.
      </p>

      <h2>Proxies and known gaps</h2>
      <ul>
        <li><strong>MOVE index</strong> is paid (ICE). The app uses realized 20-day volatility of the 10Y yield instead.</li>
        <li><strong>Auction tails</strong> need when-issued yields at 1pm. The app shows the auction high yield minus that day's constant-maturity close, which is noisy, plus bid-to-cover and indirect share vs the last six auctions of the same tenor.</li>
        <li><strong>Term premium</strong> is the Kim–Wright model from the Fed Board (FRED THREEFYTP10), updated with a lag. The NY Fed's ACM estimate is similar.</li>
        <li><strong>Credit</strong> uses Moody's Baa–10Y spread in the score because FRED only keeps three years of the ICE high-yield index; HY is shown as a tile.</li>
        <li><strong>S&amp;P 500</strong> on FRED starts in 2016, so the growth-scare score uses fewer inputs before then.</li>
      </ul>

      <h2>Debt rollover model</h2>
      <p>
        Starts from every marketable Treasury security outstanding (Monthly Statement of the Public Debt), grouped by year of maturity with its coupon.
        Each year, maturing debt plus the deficit is refinanced across a tenor mix at the scenario's curve; bills and floaters reprice every year.
        Interest feeds back into the deficit. It ignores TIPS inflation accrual, Fed remittances and intragovernmental debt, so treat the levels as approximate
        and the differences between scenarios as the signal.
      </p>

      <h2>Option stress test</h2>
      <p>
        Black–Scholes with a sticky-moneyness skew: vol(K) = ATM vol × (1 + skew × ln(S/K)). Shocks move spot and scale ATM vol, then advance time.
        Use it for sizing and comparing scenarios, not for marks.
      </p>

      <h2>Data</h2>
      <ul>
        <li>FRED: Treasury yields, breakevens, real yields, term premium, broad dollar, SOFR, IORB, reverse repo, TGA, credit spreads, VIX, S&amp;P 500, GDP.</li>
        <li>Treasury FiscalData: auction results and schedule, debt to the penny, average interest rates, MSPD maturity detail.</li>
        <li>News: Google News search feeds and the Federal Reserve press-release feed. Optional digest by Claude.</li>
      </ul>
    </div>
  );
}
