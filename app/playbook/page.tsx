import PlaybookEditor from "@/components/PlaybookEditor";
import { getMarket } from "@/lib/data";

export const revalidate = 21600;
export const metadata = { title: "Playbook · Treasury Risk Monitor" };

export default async function PlaybookPage() {
  const { regimes } = await getMarket();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Playbook</h1>
          <p>
            Decide now, while markets are calm, what you will do when each regime flashes. When a score crosses your threshold
            the dashboard shows these actions. Saved in this browser.
          </p>
        </div>
      </div>
      <PlaybookEditor regimes={regimes.regimes.map((r) => ({ id: r.id, name: r.name, tagline: r.tagline, score: r.score, alertRate: r.alertRate }))} />
    </>
  );
}
