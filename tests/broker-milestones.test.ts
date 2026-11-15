import { describe, expect, it } from "vitest";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, type Book } from "@/lib/book";
import { brokerMilestones, brokerNumbers, openDocs } from "@/lib/broker-milestones";
import type { Deal } from "@/lib/mockData";

const change = (b: Book, id: string, edit: (deal: Deal) => Deal): Book => ({ ...b, deals: b.deals.map((deal) => (deal.id === id ? edit(deal) : deal)) });

describe("broker milestone notices (rank 16)", () => {
  const b = demoBook();
  it("tells the broker when its client's loan reaches review, underwriting, an accepted term sheet, closing and payoff", () => {
    for (const status of ["initial_review", "underwriting", "term_sheet_accepted", "closing", "paid_off"] as const) {
      const after = change(b, "d3", (deal) => ({ ...deal, status }));
      expect(brokerMilestones(b, after)).toEqual([expect.objectContaining({ dealId: "d3", event: `broker.${status}`, subject: "Update on LH-DEMO-1003" })]);
    }
    expect(brokerMilestones(b, change(b, "d3", (deal) => ({ ...deal, status: "closing", closingDate: "2026-11-20" })))[0].body).toMatch(/aiming for November 20, 2026/);
    // A loan with no broker, and a step the broker already hears about, add nothing here.
    expect(brokerMilestones(b, change(b, "d1", (deal) => ({ ...deal, status: "underwriting" })))).toEqual([]);
    expect(brokerMilestones(b, change(b, "d3", (deal) => ({ ...deal, status: "clear_to_close" })))).toEqual([]);
  });
  it("tells it once every document is in, whichever action did it", () => {
    expect(openDocs(b.deals.find((deal) => deal.id === "d3")!)).toBe(4);
    let book = b;
    for (const docId of ["ein", "sow", "insurance"]) book = reducer(book, { t: "docStatus", dealId: "d3", docId, status: "accepted" });
    const last = reducer(book, { t: "docStatus", dealId: "d3", docId: "track", status: "waived" });
    expect(brokerMilestones(b, book)).toEqual([]);
    expect(brokerMilestones(book, last)).toEqual([expect.objectContaining({ event: "broker.docs_complete", subject: "Every document is in: LH-DEMO-1003" })]);
    expect(alertsFor(book, last, { t: "docStatus", dealId: "d3", docId: "track", status: "waived" }).filter((alert) => alert.to === "broker")).toHaveLength(1);
  });
  it("tells it when a draw on its client's project is released", () => {
    const draw = { id: "draw-b", dealId: "d10", requestedAt: "2026-10-01T00:00:00Z", by: "x", note: "", contact: "", photos: [], lines: [], status: "approved" as const, approved: 12_500, approvers: ["a", "b"] };
    const before = { ...b, draws: [...b.draws, draw] };
    const after = { ...before, draws: before.draws.map((item) => (item.id === "draw-b" ? { ...item, status: "funded" as const } : item)) };
    expect(brokerMilestones(before, after)).toEqual([expect.objectContaining({ dealId: "d10", event: "broker.draw_released", body: expect.stringMatching(/a draw of \$12,500\.00/) })]);
    expect(brokerMilestones(after, after)).toEqual([]);
  });
});

describe("a broker's own numbers", () => {
  it("averages days to a term sheet and to funding from submission, and counts pull-through and open conditions", () => {
    const b = demoBook();
    const mine = b.deals.filter((deal) => deal.brokerId === "brk-a");
    const numbers = brokerNumbers(mine);
    // Term sheets 6, 6 and 12 days after submitting; one loan funded, 16 days after.
    expect(numbers).toMatchObject({ submitted: 3, daysToTermSheet: 8, daysToFunding: 16, funded: 1, lost: 0, pullThrough: 100, inProcess: 2 });
    expect(numbers.openConditions).toBeGreaterThan(0);
    const withLoss = brokerNumbers([...mine, { ...mine[0], id: "x", status: "withdrawn", stages: undefined }]);
    expect(withLoss).toMatchObject({ pullThrough: 50, daysToTermSheet: 8 });
    expect(brokerNumbers([])).toMatchObject({ submitted: 0, daysToTermSheet: null, pullThrough: null });
  });
});
