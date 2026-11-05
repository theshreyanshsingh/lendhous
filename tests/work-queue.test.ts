import { describe, expect, it } from "vitest";
import { demoBook, type Book } from "@/lib/book";
import { boardMove } from "@/lib/board";
import { evaluate } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { dailyDigest } from "@/lib/reports";
import { businessHoursBetween, clockOf, floridaHolidays, isBusinessDay, SLA_TARGETS, targetsFrom } from "@/lib/sla";
import { speedScoreboard } from "@/lib/speed";
import { byUrgency, pastTarget, workQueue, type QueueItem } from "@/lib/work-queue";

const at = (local: string) => new Date(`${local}-05:00`);

describe("Florida business hours", () => {
  it("knows the state's paid holidays, moved off weekends", () => {
    expect(floridaHolidays(2026)).toEqual(["2026-01-01", "2026-01-19", "2026-05-25", "2026-07-03", "2026-09-07", "2026-11-11", "2026-11-26", "2026-11-27", "2026-12-25"]);
    expect(isBusinessDay("2026-11-27")).toBe(false);
    expect(isBusinessDay("2026-11-30")).toBe(true);
    expect(isBusinessDay("2026-11-28")).toBe(false);
  });
  it("counts 9 to 5 Eastern on business days only", () => {
    expect(businessHoursBetween(at("2026-11-02T10:00:00"), at("2026-11-02T13:30:00"))).toBe(3.5);
    // Friday 4 pm to Monday 10 am: an hour each side of the weekend.
    expect(businessHoursBetween(at("2026-11-06T16:00:00"), at("2026-11-09T10:00:00"))).toBe(2);
    // Over Thanksgiving: Wednesday noon to Monday noon is Wednesday afternoon and Monday morning.
    expect(businessHoursBetween(at("2026-11-25T12:00:00"), at("2026-11-30T12:00:00"))).toBe(8);
    expect(businessHoursBetween(at("2026-11-02T20:00:00"), at("2026-11-03T08:00:00"))).toBe(0);
  });
  it("turns amber at three quarters of the target and red past it", () => {
    const target = SLA_TARGETS.firstLook;
    expect(clockOf(at("2026-11-02T09:00:00").toISOString(), at("2026-11-02T10:00:00"), target)).toMatchObject({ state: "ok", text: "3 business hours left" });
    expect(clockOf(at("2026-11-02T09:00:00").toISOString(), at("2026-11-02T12:30:00"), target).state).toBe("amber");
    expect(clockOf(at("2026-11-02T09:00:00").toISOString(), at("2026-11-02T15:00:00"), target)).toMatchObject({ state: "red", text: "2 business hours past the target" });
    expect(clockOf("2026-11-01T00:00:00Z", new Date("2026-11-02T06:00:00Z"), SLA_TARGETS.drawDecision)).toMatchObject({ state: "red", text: "6 hours past the target" });
  });
  it("takes GT's targets from Settings, ignoring nonsense", () => {
    const targets = targetsFrom({ firstLook: 2, termSheet: "abc", drawDecision: 999 });
    expect(targets.firstLook.hours).toBe(2);
    expect(targets.termSheet.hours).toBe(SLA_TARGETS.termSheet.hours);
    expect(targets.drawDecision.hours).toBe(SLA_TARGETS.drawDecision.hours);
  });
});

describe("the work queue", () => {
  const now = at("2026-10-31T15:00:00");
  const uma = { id: "x", email: "uma.underwriter@lendhous.test" };
  it("puts the person's own loans first and links each item to where it's done", () => {
    const { mine, team } = workQueue(demoBook(), uma, now, SLA_TARGETS, 2);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((item) => item.mine)).toBe(true);
    expect(team.every((item) => !item.mine)).toBe(true);
    expect(team.some((item) => item.key === "leads" && item.label === "Answer 2 quote requests")).toBe(true);
    expect([...mine, ...team].filter((item) => item.key.startsWith("docs:")).every((item) => item.href.endsWith("?tab=Documents"))).toBe(true);
  });
  it("orders legal deadlines first, then past-target clocks, then nearly there, then by kind", () => {
    const item = (key: string, extra: Partial<QueueItem>): QueueItem => ({ key, label: key, href: "/", mine: false, priority: 10, ...extra });
    const clock = (state: "ok" | "amber" | "red") => ({ elapsed: 1, target: SLA_TARGETS.firstLook, state, text: "" });
    const sorted = [item("plain", { priority: 3 }), item("amber", { clock: clock("amber") }), item("later-deadline", { due: "2026-11-20" }), item("red", { clock: clock("red") }), item("deadline", { due: "2026-11-02" })].sort(byUrgency);
    expect(sorted.map((entry) => entry.key)).toEqual(["deadline", "later-deadline", "red", "amber", "plain"]);
  });
  it("starts a document's clock when it arrived, and a new application's when it was submitted", () => {
    const book = demoBook();
    const deal = book.deals.find((item) => item.status === "submitted")!;
    const sent = { ...book, deals: book.deals.map((item) => (item.id === deal.id ? { ...item, docs: item.docs.map((doc, i) => (i === 0 ? { ...doc, status: "uploaded" as const, uploadedAt: at("2026-10-29T10:00:00").toISOString() } : doc)) } : item)) };
    const all = Object.values(workQueue(sent, uma, now)).flat();
    expect(all.find((entry) => entry.key === `docs:${deal.id}`)?.clock?.state).toBe("red");
    expect(all.find((entry) => entry.key === `new:${deal.id}`)?.clock).toBeDefined();
    expect(pastTarget(sent, now).some((line) => line.startsWith("Review") && line.includes(deal.loanNumber))).toBe(true);
  });
  it("puts what's past its target in the owners' morning email", () => {
    const digest = dailyDigest(demoBook(), "2026-10-31", [], "https://x/admin/reports", 0, ["Review 1 document · LH-1 · Uma · 2 business hours past the target"]);
    expect(digest.body).toContain("Past their target:\n- Review 1 document · LH-1 · Uma");
    expect(dailyDigest(demoBook(), "2026-10-31", [], "https://x/admin/reports").body).not.toContain("Past their target");
  });
});

describe("the pipeline board", () => {
  const book = demoBook();
  const find = (status: Deal["status"]) => book.deals.find((deal) => deal.status === status)!;
  it("moves a loan only to its next step, with the loan page's checks", () => {
    const fresh = find("submitted");
    expect(boardMove(fresh, evaluate(fresh.app), "initial_review")).toEqual({ ok: true });
    expect(boardMove(fresh, evaluate(fresh.app), "conditions")).toEqual({ ok: false, why: expect.stringContaining("one step at a time") });
    expect(boardMove(fresh, evaluate(fresh.app), "submitted")).toEqual({ ok: false, why: expect.stringContaining("already there") });
    const underwriting = find("underwriting");
    expect(boardMove(underwriting, evaluate(underwriting.app), "term_sheet_issued")).toEqual({ ok: false, why: expect.stringMatching(/term sheet on the loan page|Not yet/) });
    const issued = find("term_sheet_issued");
    expect(boardMove(issued, evaluate(issued.app), "term_sheet_accepted")).toEqual({ ok: false, why: expect.stringContaining("borrower's") });
  });
});

describe("the speed scoreboard", () => {
  it("takes the median and slowest wait in the period against the target, by loan officer", () => {
    const base = demoBook();
    const officer = { id: "o", name: "Olga Officer", email: "o@x", phone: "", title: "" };
    const deal = (id: string, submitted: string, reviewed: string): Deal => ({ ...base.deals[0], id, loanNumber: id, team: { officer }, stages: [{ status: "submitted", at: at(submitted).toISOString() }, { status: "initial_review", at: at(reviewed).toISOString() }], termSheets: [] });
    const book: Book = { ...base, deals: [deal("A", "2026-11-02T09:00:00", "2026-11-02T10:00:00"), deal("B", "2026-11-02T09:00:00", "2026-11-02T12:00:00"), deal("C", "2026-11-02T09:00:00", "2026-11-03T09:00:00")], draws: [] };
    const board = speedScoreboard(book, { from: "2026-11-01", to: "2026-11-30" });
    expect(board.measures.find((measure) => measure.key === "firstLook")?.overall).toEqual({ count: 3, median: 3, slowest: 8, met: 2 });
    expect(board.byOfficer).toEqual([expect.objectContaining({ name: "Olga Officer" })]);
    expect(speedScoreboard(book, { from: "2026-12-01", to: "2026-12-31" }).measures[0].overall.count).toBe(0);
  });
});
