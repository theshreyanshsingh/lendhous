import { HouseArt } from "@/components/art/HouseArt";
import { recentlyFunded } from "@/lib/showcase-store";

const PROGRAM: Record<string, string> = { fix_flip: "Fix & flip", bridge: "Bridge", ground_up: "Ground-up construction", dscr: "DSCR rental" };
const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const month = (value: string) => new Date(`${value}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Loans LendHous funded whose borrowers chose to show them: the city, the program, the amount and a photo. */
export async function RecentlyFunded() {
  const items = await recentlyFunded().catch(() => []);
  if (!items.length) return null;
  return (
    <section className="section funded-section" data-testid="recently-funded">
      <div className="eyebrow">RECENTLY FUNDED</div>
      <h2>Projects we&rsquo;ve backed.</h2>
      <ul className="funded-grid">
        {items.map((item) => (
          <li key={item.dealId} className="funded-card" data-testid="funded-card">
            <div className="funded-picture">
              {/* eslint-disable-next-line @next/next/no-img-element -- a borrower's own photo, shown with their permission */}
              {item.photoId ? <img src={`/api/showcase/${item.dealId}`} alt={`A ${PROGRAM[item.product].toLowerCase()} project in ${item.city}`} loading="lazy" /> : <HouseArt product={item.product} label={`A ${PROGRAM[item.product].toLowerCase()} project in ${item.city}`} />}
            </div>
            <p className="funded-city">{item.city}, Florida</p>
            <p className="funded-meta">{PROGRAM[item.product]} · {money(item.amount)}</p>
            <p className="funded-when">Funded {month(item.fundedMonth)}</p>
          </li>
        ))}
      </ul>
      <p className="funded-note">Shown with each borrower&rsquo;s permission. Amounts rounded to the nearest thousand.</p>
    </section>
  );
}
