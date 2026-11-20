import { describe, expect, it } from "vitest";
import { demoBook } from "@/lib/book";
import { audienceIds, campaignFooter, campaignProblem, rateSheetDraft } from "@/lib/campaigns";
import { DEMO_BROKER_ID } from "@/lib/mockData";
import { can } from "@/lib/permissions";
import { currentPricing } from "@/lib/pricing-versions";
import { unsubscribeToken, unsubscribeUser } from "@/lib/unsubscribe";

const b = demoBook();
const ADDRESS = "100 Sample Way (FAKE)\nFort Lauderdale, FL 33301";

describe("email campaigns (rank 29)", () => {
  it("can't go out without the mailing address, an honest subject and a message", () => {
    const input = { audience: "brokers" as const, subject: "LendHous rates this week", body: "Hello" };
    expect(campaignProblem(input, ADDRESS)).toBeNull();
    expect(campaignProblem(input, "")).toMatch(/mailing address in Settings first/);
    expect(campaignProblem({ ...input, subject: " " }, ADDRESS)).toMatch(/subject/);
    expect(campaignProblem({ ...input, body: "" }, ADDRESS)).toBe("Write the message.");
    expect(campaignProblem({ ...input, audience: "everyone" as never }, ADDRESS)).toBe("Choose who it goes to.");
  });

  it("goes to approved brokers' people, or borrowers whose loans funded or paid off", () => {
    const brokerUsers = [{ id: "u1", firmId: DEMO_BROKER_ID }, { id: "u2", firmId: "brk-applied" }];
    expect(audienceIds(b, "brokers", brokerUsers)).toEqual(["u1"]);
    const funded = new Set(b.deals.filter((deal) => ["funded", "servicing_current", "servicing_delinquent", "matured", "default", "paid_off"].includes(deal.status)).map((deal) => deal.borrowerId));
    expect(new Set(audienceIds(b, "borrowers", []))).toEqual(funded);
    expect(audienceIds(b, "past_borrowers", [])).toEqual([]);
    const paid = { ...b, deals: b.deals.map((deal) => (deal.id === "d2" ? { ...deal, status: "paid_off" as const } : deal)) };
    expect(audienceIds(paid, "past_borrowers", [])).toEqual([b.deals.find((deal) => deal.id === "d2")!.borrowerId]);
  });

  it("ends every email with the address and an unsubscribe link only its account can use", () => {
    const footer = campaignFooter(ADDRESS, "https://lendhous.example/unsubscribe/abc");
    expect(footer).toContain("LendHous · 100 Sample Way (FAKE), Fort Lauderdale, FL 33301");
    expect(footer).toContain("To stop these emails: https://lendhous.example/unsubscribe/abc");
    const token = unsubscribeToken("user-123");
    expect(unsubscribeUser(token)).toBe("user-123");
    expect(unsubscribeUser(`${Buffer.from("user-999").toString("base64url")}.${token.split(".")[1]}`)).toBeNull();
    expect(unsubscribeUser("garbage")).toBeNull();
  });

  it("drafts a rate sheet for brokers from today's pricing, and is an owner's permission", () => {
    const draft = rateSheetDraft(currentPricing(), "https://lendhous.example/broker-sheet");
    expect(draft.audience).toBe("brokers");
    expect(draft.body).toMatch(/• Fix & flip: 10–11% \(10\+ deals\) to 12–13% \(0–1 deals\)/);
    expect(draft.body).toMatch(/• DSCR rental: 80% at 7\.00% \(credit 760\+\)/);
    expect(can(["ADMIN_OWNER"], "send_campaigns")).toBe(true);
    expect(can(["CAPITAL_MANAGER"], "send_campaigns")).toBe(false);
  });
});
