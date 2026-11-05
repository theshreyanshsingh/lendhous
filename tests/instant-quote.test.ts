import { describe, expect, it } from "vitest";
import type { NextConfig } from "next";
// @ts-expect-error -- the config is plain JavaScript, with no types of its own
import config from "../next.config.mjs";
import { demoBook } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { pricingConfig } from "@/lib/pricing-config";
import { cashToCloseParts, dealProblem, indicativeTerms, quoteApplication, quoteProblem, type QuoteDeal } from "@/lib/quote";
import { channelLabel, channelOf, embedChannel, embedPath, embedSnippet, quoteFunnel, refOf, share, siteSlug } from "@/lib/quote-funnel";

const deal = (change: Partial<QuoteDeal> = {}): QuoteDeal => ({
  citizenship: "us", creditBand: "720-759", experience: "3-4", address: { street: "100 Test Way", city: "Hollywood", state: "FL", zip: "33020", county: "Broward" },
  propertyType: "sfr", loanType: "fix_flip", purpose: "purchase", purchasePrice: 300_000, rehab: 80_000, arv: 520_000, fundingDate: "2026-12-15", comps: [], exit: "sell", notes: "", ...change,
});
const people = { submitter: "borrower", borrower: { firstName: "Tess", lastName: "Test", email: "tess@example.org", phone: "(954) 555-0100" } };

describe("terms before contact details", () => {
  it("prices a deal with no name, email or phone, and saving still needs them", () => {
    expect("deal" in dealProblem(deal())).toBe(true);
    expect(quoteProblem(deal())).toEqual({ error: expect.any(String) });
    expect("quote" in quoteProblem({ ...deal(), ...people })).toBe(true);
  });
  it("still asks for what the terms depend on", () => {
    expect(dealProblem(deal({ arv: undefined }))).toEqual({ error: "Add the after-repair value (ARV)." });
    expect(dealProblem(deal({ loanType: "dscr", monthlyRent: undefined }))).toEqual({ error: "Add the monthly rent." });
    expect(dealProblem({ ...deal(), address: { street: "", city: "", state: "", zip: "", county: "" } })).toEqual({ error: "Add the property's street address." });
  });
  it("shows the same numbers the engine would give the loan", () => {
    const terms = indicativeTerms(deal(), pricingConfig)!;
    const engine = evaluate(quoteApplication(deal())!, pricingConfig);
    expect(terms).toMatchObject({ noteAmount: engine.noteAmount, rate: engine.rate, pointsPct: engine.pointsPct, cashToClose: engine.cashToClose, monthlyPayment: engine.monthlyPayment });
    expect(terms.eligible).toBe(true);
  });
  it("itemizes the cash to close so it adds up, on a purchase and a refinance", () => {
    for (const purpose of ["purchase", "cash_out"] as const) {
      const priced = deal({ purpose, loanType: "bridge", rehab: 0, arv: undefined });
      const terms = indicativeTerms(priced, pricingConfig)!;
      const parts = cashToCloseParts(priced, terms, pricingConfig);
      expect(Math.round(parts.reduce((sum, part) => sum + part.amount, 0))).toBe(Math.round(terms.cashToClose));
      expect(parts.some((part) => part.label.startsWith("Points"))).toBe(true);
    }
    const flip = indicativeTerms(deal(), pricingConfig)!;
    expect(cashToCloseParts(deal(), flip, pricingConfig)[0]).toMatchObject({ label: expect.stringContaining("Down payment"), amount: 300_000 - flip.initialAdvance });
  });
});

const nextConfig = config as NextConfig;

describe("the quote widget", () => {
  it("only takes clean channel, site and referral names", () => {
    expect(channelOf("embed:wholesale")).toBe("embed:wholesale");
    expect(channelOf("embed:<script>")).toBe("site");
    expect(channelOf(undefined)).toBe("site");
    expect(embedChannel("realty")).toBe("embed:realty");
    expect(embedChannel("Not Ok")).toBe("embed");
    expect(siteSlug("a".repeat(25))).toBe("");
    expect(refOf("demobrkr")).toBe("demobrkr");
    expect(refOf("x\"><")).toBe("");
    expect(channelLabel("embed:wholesale")).toBe("Quote widget on wholesale");
  });
  it("gives a site code that frames the widget and only listens to LendHous for its height", () => {
    expect(embedPath({ ref: "demobrkr", site: "realty" })).toBe("/embed/quote?ref=demobrkr&site=realty");
    expect(embedPath({ ref: "\"><x" })).toBe("/embed/quote");
    const code = embedSnippet("https://lendhous.example", { ref: "demobrkr" });
    expect(code).toContain('src="https://lendhous.example/embed/quote?ref=demobrkr"');
    expect(code).toContain('e.origin!=="https://lendhous.example"');
  });
  it("is the only page another site may frame", async () => {
    const rules = await nextConfig.headers!();
    const deny = rules.find((rule) => rule.headers.some((header) => header.key === "X-Frame-Options"))!;
    const pattern = new RegExp(`^${deny.source.replace(/^\//, "\\/")}$`);
    for (const path of ["/", "/start", "/admin/deals/d1", "/login"]) expect(pattern.test(path)).toBe(true);
    expect(pattern.test("/embed/quote")).toBe(false);
    const embed = rules.find((rule) => rule.source === "/embed/:path*")!;
    expect(embed.headers).toContainEqual({ key: "Content-Security-Policy", value: "frame-ancestors *" });
  });
});

describe("the quote funnel", () => {
  const book = demoBook();
  const approved = book.brokers.find((broker) => broker.referralCode)!;
  const funded = book.deals.find((item) => item.status === "servicing_current")!;
  const open = book.deals.find((item) => item.status === "underwriting")!;
  const period = { from: "2026-10-01", to: "2026-10-31" };
  it("counts each channel and referring broker from started to funded, in the period only", () => {
    const counts = [
      { day: "2026-10-05", channel: "site", ref: "", started: 40, shown: 25 },
      { day: "2026-10-06", channel: "embed:wholesale", ref: "", started: 10, shown: 8 },
      { day: "2026-10-07", channel: "site", ref: approved.referralCode!, started: 5, shown: 4 },
      { day: "2026-09-30", channel: "site", ref: "", started: 99, shown: 99 },
    ];
    const leads = [
      { day: "2026-10-05", channel: "site", brokerId: null, loanId: funded.id },
      { day: "2026-10-05", channel: "site", brokerId: null, loanId: null },
      { day: "2026-10-06", channel: "embed:wholesale", brokerId: null, loanId: open.id },
      { day: "2026-10-07", channel: "site", brokerId: approved.id, loanId: null },
      { day: "2026-11-01", channel: "site", brokerId: null, loanId: null },
    ];
    const { rows, total } = quoteFunnel(counts, leads, book, period);
    const site = rows.find((row) => row.key === "site")!;
    expect(site).toMatchObject({ started: 40, shown: 25, saved: 2, loans: 1, funded: 1 });
    expect(rows.find((row) => row.key === "embed:wholesale")).toMatchObject({ label: "Quote widget on wholesale", saved: 1, loans: 1, funded: 0 });
    expect(rows.find((row) => row.key === `site|${approved.referralCode}`)).toMatchObject({ label: `Website quote page, referred by ${approved.name}`, started: 5, saved: 1 });
    expect(total).toMatchObject({ started: 55, shown: 37, saved: 4, loans: 2, funded: 1 });
    expect(share(total.saved, total.shown)).toBe("11%");
    expect(share(1, 0)).toBe("—");
  });
});
