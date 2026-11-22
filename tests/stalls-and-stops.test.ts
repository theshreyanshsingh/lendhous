import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { DEMO_PARTNER_ID, type Deal, type DrawRequest } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { advancing, noticeDueOn, noticeStatus, openStop, releaseHolds, stopHold, stopNoticeText, stopProblem, stopRecipients } from "@/lib/stop-advance";
import { projectPace, paceWords, stalledToAsk, STALL_DAYS } from "@/lib/project-pace";
import { followUpProblem, needsFollowUp } from "@/lib/surveys";
import { drawPlan, planChoices } from "@/lib/draw-planner";
import { setDrawFees } from "@/lib/draw-review";
import { monthlyLine } from "@/lib/holder-view";
import { workQueue } from "@/lib/work-queue";
import { addDays } from "@/lib/servicing";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, ...(organizationId ? { organizationId } : {}) });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const deal = (b: Book, id: string) => b.deals.find((item) => item.id === id)!;
const underwriter = person("uw", ["UNDERWRITER"]);
const processor = person("proc", ["PROCESSOR"]);
const servicer = person("svc", ["SERVICER"]);
const owner = person("owner", ["ADMIN_OWNER"]);
const day = serviceDay(demoBook());
// d2 is the demo borrower's funded flip, advancing, with nothing stopped; d13 has advances stopped in the demo.
const fresh = () => { const b = demoBook(); return { ...b, deals: b.deals.map((item) => (item.id === "d13" ? { ...item, advanceStops: undefined } : item)) }; };

describe("stopping advances (Fla. Stat. 713.3471)", () => {
  it("counts the notice's 5 business days past weekends and Florida's holidays", () => {
    // Friday November 20, 2026: Thanksgiving and the day after don't count.
    expect(noticeDueOn("2026-11-20")).toBe("2026-12-01");
    expect(noticeDueOn("2026-10-29")).toBe("2026-11-05");
  });

  it("stops only a funded rehab with holdback left, once, for a reason", () => {
    const b = fresh();
    expect(advancing(deal(b, "d2"))).toBe(true);
    expect(advancing(deal(b, "d10"))).toBe(false);
    expect(stopProblem(deal(b, "d10"), day, "default", "", day)).toMatch(/Only a funded rehab/);
    expect(stopProblem(deal(b, "d2"), addDays(day, 1), "default", "", day)).toMatch(/today or earlier/);
    expect(stopProblem(deal(b, "d2"), day, "other", " ", day)).toMatch(/Say why/);
    expect(stopProblem(deal(b, "d2"), day, "stalled", "", day)).toBeNull();
  });

  it("holds every draw, tells the borrower, the team and the holders, and puts the notice on the queue with its deadline", () => {
    const b = fresh();
    const stop: BookAction = { t: "stopAdvances", dealId: "d13", on: day, reason: "default", note: "", by: "" };
    expect(check(b, processor, stop)).toHaveProperty("error");
    const { after, action } = run(b, underwriter, stop);
    const d13 = deal(after, "d13");
    expect(openStop(d13)).toMatchObject({ on: day, reason: "default", by: "uw name" });
    expect(stopHold(d13)).toMatch(/Advances are stopped/);
    const draw = after.draws.find((item) => item.dealId === "d13")!;
    expect(releaseHolds(d13, { ...draw, status: "approved", approved: 1_000 } as DrawRequest, day)[0]).toMatch(/Advances are stopped/);
    expect(alertsFor(b, after, action).map((alert) => alert.to)).toEqual(expect.arrayContaining(["borrower", "team"]));
    const item = workQueue(after, { id: "" }, new Date(`${day}T15:00:00Z`)).team.find((entry) => entry.key === "stopnotice:d13");
    expect(item).toMatchObject({ due: noticeDueOn(day), label: expect.stringContaining("713.3471") });
    expect(stopRecipients(d13).map((person) => person.key)).toEqual(["contractor"]);
    expect(stopNoticeText(d13, stopRecipients(d13)[0], openStop(d13)!)).toContain("stopped making advances");
    // A servicer records the notice sent; then nothing's left to send.
    const sent = run(after, servicer, { t: "stopNoticeSent", dealId: "d13", key: "contractor", sentOn: day, method: "mail", by: "" }).after;
    expect(noticeStatus(deal(sent, "d13"), day)?.missing).toEqual([]);
    expect(check(sent, servicer, { t: "stopNoticeSent", dealId: "d13", key: "contractor", sentOn: day, method: "mail", by: "" })).toMatchObject({ error: expect.stringContaining("already") });
    // Starting again needs what changed, and lifts the hold.
    expect(check(sent, underwriter, { t: "resumeAdvances", dealId: "d13", on: day, note: " ", by: "" })).toHaveProperty("error");
    const resumed = run(sent, underwriter, { t: "resumeAdvances", dealId: "d13", on: day, note: "Brought current", by: "" });
    expect(stopHold(deal(resumed.after, "d13"))).toBeNull();
    expect(alertsFor(sent, resumed.after, resumed.action).find((alert) => alert.to === "borrower")?.subject).toMatch(/can go ahead again/);
  });

  it("asks whether to stop advances when a loan with holdback left goes into default", () => {
    const b = fresh();
    // d13 is behind on its payments, with holdback left.
    const defaulted = run(b, owner, { t: "declareDefault", dealId: "d13", kind: "monetary", effectiveOn: day, note: "Payments missed", by: "" }).after;
    expect(deal(defaulted, "d13").status).toBe("default");
    const queue = workQueue(defaulted, { id: "" }, new Date(`${day}T15:00:00Z`));
    expect([...queue.team, ...queue.mine].some((entry) => entry.key === "stopask:d13")).toBe(true);
  });

  it("parses the requests a browser sends", () => {
    expect(parseAction({ t: "stopAdvances", dealId: "d2", on: day, reason: "stalled", note: "", by: "" })).toBeTruthy();
    expect(parseAction({ t: "stopAdvances", dealId: "d2", on: day, reason: "whim", note: "", by: "" })).toBeNull();
    expect(parseAction({ t: "checkPace", asOf: day })).toBeNull();
  });
});

describe("a rehab's pace (lib/project-pace.ts)", () => {
  const funded = (b: Book, changes: Partial<Deal>) => ({ ...deal(b, "d2"), ...changes });
  it("compares the share drawn with the share of the term used", () => {
    const b = demoBook();
    const pace = projectPace(deal(b, "d2"), b.draws, day)!;
    expect(pace.state).toBe("on_pace");
    expect(pace.drawn).toBeGreaterThan(0);
    expect(paceWords(pace)).toMatch(/of the rehab budget drawn/);
    expect(projectPace(deal(b, "d10"), b.draws, day)).toBeNull();
  });

  it("calls a project stalled after weeks with no draw, and behind when drawing lags the term", () => {
    const b = demoBook();
    const quiet = funded(b, { closingDate: addDays(day, -(STALL_DAYS + 30)) });
    const stalled = projectPace(quiet, [], day)!;
    expect(stalled.state).toBe("stalled");
    expect(stalled.quietDays).toBe(STALL_DAYS + 30);
    // Most of the term gone with little drawn and a recent draw: behind, and late to finish at this rate.
    const late = funded(b, { closingDate: addDays(day, -300), disbursedDraws: 5_000 });
    const behind = projectPace(late, [{ dealId: "d2", requestedAt: `${addDays(day, -3)}T15:00:00Z`, status: "submitted" }], day)!;
    expect(behind.state).toBe("behind");
    expect(behind.lateFinish).toBe(true);
    expect(paceWords(behind)).toMatch(/runs past maturity/);
  });

  it("asks a stalled project's borrower for an update once a month, and tells the team", () => {
    const b = demoBook();
    const old = { ...b, deals: b.deals.map((item) => (item.id === "d2" ? { ...item, closingDate: addDays(day, -90) } : item)), draws: b.draws.filter((draw) => draw.dealId !== "d2") };
    expect(stalledToAsk(old.deals, old.draws, day)).toContain("d2");
    expect(check(old, owner, { t: "checkPace", asOf: day })).toHaveProperty("error");
    const { after, action } = run(old, person("server", []), { t: "checkPace", asOf: day }, true);
    expect(deal(after, "d2").paceAsked).toEqual([day]);
    const alerts = alertsFor(old, after, action);
    expect(alerts.find((alert) => alert.to === "borrower" && alert.dealId === "d2")?.body).toMatch(/haven't had a draw request/);
    expect(alerts.find((alert) => alert.to === "team")?.body).toContain(deal(b, "d2").loanNumber);
    expect(stalledToAsk(after.deals, after.draws, addDays(day, 10))).not.toContain("d2");
    expect(stalledToAsk(after.deals, after.draws, addDays(day, 30))).toContain("d2");
    // The loan's holders see it in its monthly line, and the team on its queue.
    expect(monthlyLine(deal(after, "d2"), {}, day).some((line) => line.text.startsWith("Stalled"))).toBe(true);
    expect([...workQueue(after, { id: "" }, new Date(`${day}T15:00:00Z`)).team, ...workQueue(after, { id: "" }, new Date(`${day}T15:00:00Z`)).mine].some((entry) => entry.key === "stalled:d2")).toBe(true);
  });

  it("works out a holder's pace from the last draw asked for, on the server", () => {
    const b = demoBook();
    const shared = { ...b, bids: [...b.bids, { id: "bid-pace", dealId: "d2", partnerId: DEMO_PARTNER_ID, pct: 100, lenderRate: 9, lenderPoints: 0, conditions: "", status: "accepted" as const, type: "bid" as const, at: "2026-09-01T00:00:00Z" }], deals: b.deals.map((item) => (item.id === "d2" ? { ...item, teaserSentTo: [DEMO_PARTNER_ID] } : item)) };
    const seen = scopeBook(shared, person("pia", ["PARTNER_LENDER"], DEMO_PARTNER_ID)).deals.find((item) => item.id === "d2");
    expect(seen?.holderWatch?.lastAsked).toBe(b.draws.find((draw) => draw.dealId === "d2")!.requestedAt);
  });
});

describe("low survey scores (lib/surveys.ts)", () => {
  it("tells the team about a 6 or less, keeps it on the queue, and takes a manager's follow-up", () => {
    const b = demoBook();
    // The demo's d13 borrower scored their closing 6.
    expect(needsFollowUp(deal(b, "d13")).map((answer) => answer.score)).toEqual([6]);
    expect([...workQueue(b, { id: "" }, new Date(`${day}T15:00:00Z`)).team, ...workQueue(b, { id: "" }, new Date(`${day}T15:00:00Z`)).mine].find((entry) => entry.key === "survey:d13:funded")?.label).toBe("Follow up a survey score of 6 out of 10");
    expect(followUpProblem(deal(b, "d13"), "funded", " ")).toMatch(/what you heard/);
    expect(followUpProblem(deal(b, "d11"), "funded", "x")).toMatch(/no low score/);
    expect(check(b, person("someone", ["BORROWER"]), { t: "surveyFollowUp", dealId: "d13", stage: "funded", note: "x", by: "" })).toHaveProperty("error");
    const done = run(b, processor, { t: "surveyFollowUp", dealId: "d13", stage: "funded", note: "Called; the appraisal desk now quotes a date up front", by: "" }).after;
    expect(needsFollowUp(deal(done, "d13"))).toEqual([]);
    expect(deal(done, "d13").surveys![0].followUp).toMatchObject({ by: "proc name" });
  });

  it("alerts the team the moment a borrower answers with a low score", () => {
    const b = demoBook();
    const d17 = { ...deal(b, "d17"), surveys: undefined };
    const ready = { ...b, deals: b.deals.map((item) => (item.id === "d17" ? d17 : item)) };
    const borrower = person(d17.borrowerId, ["BORROWER"]);
    const { after, action } = run(ready, borrower, { t: "answerSurvey", dealId: "d17", stage: "funded", score: 3, comment: "Slow" });
    expect(alertsFor(ready, after, action)).toEqual([expect.objectContaining({ to: "team", subject: expect.stringContaining("3 out of 10") })]);
    const happy = run(ready, borrower, { t: "answerSurvey", dealId: "d17", stage: "funded", score: 9, comment: "" });
    expect(alertsFor(ready, happy.after, happy.action)).toEqual([]);
  });
});

describe("the draw cash planner (lib/draw-planner.ts)", () => {
  it("splits what's left into draws, with what the borrower carries, how long it takes and the fees", () => {
    const b = demoBook();
    setDrawFees({ desk: 95, inspector: 225 });
    const before = drawPlan(deal(b, "d1"), 4)!;
    const estimate = evaluate(deal(b, "d1").app);
    expect(before).toMatchObject({ left: estimate.holdback, draws: 4, perDraw: Math.round(estimate.holdback / 4), toStart: estimate.cashToClose + Math.round(estimate.holdback / 4) });
    // A single home's draws of $25,000 can be checked from photos, in a business day; an inspector takes two more.
    expect(before.days).toEqual({ desk: 1, inspector: 3 });
    expect(before.fees).toBe(4 * 95);
    // A big construction draw is over the photo review's limit: an inspector every time.
    const large = drawPlan(deal(b, "d5"), 2)!;
    expect(large.days.desk).toBeUndefined();
    expect(large.fees).toBe(2 * 225);
    // Once funded, it's what's left of the holdback, and nothing more to start with.
    const funded = drawPlan(deal(b, "d2"), 2)!;
    expect(funded.toStart).toBeUndefined();
    expect(funded.left).toBeLessThan(evaluate(deal(b, "d2").app).holdback);
    expect(planChoices(deal(b, "d2")).map((plan) => plan.draws)).toEqual([2, 3, 4, 5, 6, 8]);
    expect(drawPlan(deal(b, "d10"), 4)).toBeNull();
    setDrawFees({ desk: 0, inspector: 0 });
  });
});
