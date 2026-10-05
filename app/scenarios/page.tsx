import DebtRollover from "@/components/DebtRollover";
import PortfolioStress from "@/components/PortfolioStress";
import { getFiscal, getMarket } from "@/lib/data";

export const revalidate = 21600;
export const metadata = { title: "Scenarios · Treasury Risk Monitor" };

export default async function Scenarios() {
  const [market, fiscal] = await Promise.all([getMarket(), getFiscal()]);
  const { curve } = market;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Scenarios</h1>
          <p>
            Ranges, not forecasts. The first model rolls the government's actual maturity schedule through different rate paths;
            the second stress-tests your SPX option hedges against shocks shaped like each regime.
          </p>
        </div>
      </div>

      <div className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h2>Debt rollover: what higher rates do to the interest bill</h2>
        </div>
        {fiscal.profile && fiscal.gdp && Number.isFinite(curve.y10) ? (
          <DebtRollover profile={fiscal.profile} curve={{ m3: curve.m3, y2: curve.y2, y10: curve.y10, y30: curve.y30 }} gdp={fiscal.gdp} />
        ) : (
          <div className="card small muted">Treasury maturity data or the yield curve is unavailable right now; try again later.</div>
        )}
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Your hedges: SPX option stress test</h2>
        </div>
        <PortfolioStress
          spot={Number.isFinite(curve.spx) ? curve.spx : 6000}
          vix={Number.isFinite(curve.vix) ? curve.vix : 18}
          shortRate={Number.isFinite(curve.m3) ? curve.m3 : 4}
          today={today}
        />
      </div>
    </>
  );
}
