import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { canonicalUrl } from "@/lib/canonical-url";
import { dealProblem, quoteProblem } from "@/lib/quote";
import { contactFrom, nmlsLookup, telHref } from "@/lib/site-contact";
import { middleware } from "@/middleware";

const SITE = "https://lendhous.com";
const at = (changes: Partial<Parameters<typeof canonicalUrl>[0]> = {}) => ({ host: "lendhous.com", path: "/rates", search: "?a=1", cfVisitor: '{"scheme":"https"}', ...changes });

describe("https and the bare host", () => {
  it("sends plain http through Cloudflare to the https site, keeping the path and query", () => {
    expect(canonicalUrl(at({ cfVisitor: '{"scheme":"http"}' }), SITE)).toBe("https://lendhous.com/rates?a=1");
  });
  it("sends the www host to the bare host, over https", () => {
    expect(canonicalUrl(at({ host: "www.lendhous.com" }), SITE)).toBe("https://lendhous.com/rates?a=1");
    expect(canonicalUrl(at({ host: "WWW.LendHous.com", cfVisitor: '{"scheme":"http"}', path: "/", search: "" }), SITE)).toBe("https://lendhous.com/");
  });
  it("leaves https visitors on the bare host alone, so it can never loop", () => {
    expect(canonicalUrl(at(), SITE)).toBeNull();
    expect(canonicalUrl(at({ cfVisitor: '{"scheme":"https"}', host: "lendhous.com" }), "https://lendhous.com/")).toBeNull();
  });
  it("leaves a request that didn't come through Cloudflare alone, whatever a proxy says", () => {
    expect(canonicalUrl(at({ cfVisitor: null }), SITE)).toBeNull();
    expect(canonicalUrl(at({ cfVisitor: "not json" }), SITE)).toBeNull();
    expect(canonicalUrl(at({ cfVisitor: '{"scheme":5}' }), SITE)).toBeNull();
  });
  it("changes nothing without an https site address", () => {
    expect(canonicalUrl(at({ cfVisitor: '{"scheme":"http"}' }), "http://localhost:3000")).toBeNull();
    expect(canonicalUrl(at({ host: "www.lendhous.com" }), undefined)).toBeNull();
    expect(canonicalUrl(at({ host: "www.lendhous.com" }), "nonsense")).toBeNull();
    // A site address on www itself would send www back to www.
    expect(canonicalUrl(at({ host: "www.lendhous.com" }), "https://www.lendhous.com")).toBeNull();
  });
});

describe("the middleware", () => {
  const before = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => { process.env.NEXT_PUBLIC_APP_URL = before; });
  const request = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });

  it("redirects http and www with a 308 before anything else", async () => {
    process.env.NEXT_PUBLIC_APP_URL = SITE;
    const http = await middleware(request("http://lendhous.com/admin/loans?x=1", { host: "lendhous.com", "cf-visitor": '{"scheme":"http"}' }));
    expect(http.status).toBe(308);
    expect(http.headers.get("location")).toBe("https://lendhous.com/admin/loans?x=1");
    const www = await middleware(request("https://www.lendhous.com/start", { host: "www.lendhous.com", "cf-visitor": '{"scheme":"https"}' }));
    expect(www.status).toBe(308);
    expect(www.headers.get("location")).toBe("https://lendhous.com/start");
  });
  it("lets the public site through without a session", async () => {
    process.env.NEXT_PUBLIC_APP_URL = SITE;
    const response = await middleware(request("https://lendhous.com/privacy", { host: "lendhous.com", "cf-visitor": '{"scheme":"https"}' }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
  it("still sends /admin without a session to sign in, and only /admin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = SITE;
    const admin = await middleware(request("https://lendhous.com/admin/loans", { host: "lendhous.com", "cf-visitor": '{"scheme":"https"}' }));
    expect(admin.status).toBe(307);
    expect(admin.headers.get("location")).toBe("https://lendhous.com/login?next=%2Fadmin%2Floans");
    const lookalike = await middleware(request("https://lendhous.com/administrator", { host: "lendhous.com" }));
    expect(lookalike.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("the quote form's messages", () => {
  it("says what to fill in on an empty form, never the checker's own words", () => {
    const empty = { citizenship: "", creditBand: "", experience: "", address: { street: "", city: "", state: "", zip: "", county: "" }, propertyType: "sfr", loanType: "fix_flip", purpose: "purchase", purchasePrice: 0, rehab: 0, fundingDate: "", comps: [], exit: "sell", notes: "" };
    const deal = dealProblem(empty);
    expect(deal).toEqual({ error: "Choose the borrower's citizenship." });
    const quote = quoteProblem({ submitter: "borrower", borrower: { firstName: "", lastName: "", email: "", phone: "" }, ...empty });
    expect("error" in quote && quote.error).not.toMatch(/invalid|expected|received|option/i);
  });
  it("has plain words for every field the form can get wrong", () => {
    const fields: [string, unknown][] = [["creditBand", "x"], ["experience", "x"], ["propertyType", "x"], ["loanType", "x"], ["purpose", "x"], ["exit", "x"], ["notes", "x".repeat(2000)], ["comps", [{ address: "", price: 0, soldOn: "" }]], ["beds", -1], ["rehab", -5]];
    const good = { citizenship: "us", creditBand: "720-759", experience: "3-4", address: { street: "12 Palm Way", city: "Miami", state: "FL", zip: "33101", county: "Miami-Dade" }, propertyType: "sfr", loanType: "bridge", purpose: "purchase", purchasePrice: 300000, rehab: 0, fundingDate: "2026-12-15", comps: [], exit: "sell", notes: "" };
    expect(dealProblem(good)).toHaveProperty("deal");
    for (const [field, value] of fields) {
      const result = dealProblem({ ...good, [field]: value });
      expect("error" in result ? result.error : "", field).toMatch(/^(Choose|Check|Shorten|Add)/);
    }
  });
});

describe("LendHous's public contact details", () => {
  it("shows only what an owner set, and an NMLS ID's digits", () => {
    expect(contactFrom({ lenderPhone: " (305) 555-0100 ", contactEmail: "hello@lendhous.com", lenderAddress: "1 Main St\nMiami, FL 33101", nmlsId: "NMLS #12 345" })).toEqual({ phone: "(305) 555-0100", email: "hello@lendhous.com", address: "1 Main St\nMiami, FL 33101", nmlsId: "12345" });
    // A settings record saved before these fields existed.
    expect(contactFrom({})).toEqual({ phone: "", email: "", address: "", nmlsId: "" });
    expect(contactFrom({ contactEmail: null, nmlsId: null })).toEqual({ phone: "", email: "", address: "", nmlsId: "" });
  });
  it("links a phone and an NMLS ID", () => {
    expect(telHref("(305) 555-0100")).toBe("tel:3055550100");
    expect(telHref("+1 305 555 0100")).toBe("tel:+13055550100");
    expect(nmlsLookup("12345")).toBe("https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/12345");
  });
});
