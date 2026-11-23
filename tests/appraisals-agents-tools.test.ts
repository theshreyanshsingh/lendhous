import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { parseAction } from "@/lib/book-actions";
import { alertsFor } from "@/lib/book-alerts";
import { demoBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { can, type Permission } from "@/lib/permissions";
import { addDays } from "@/lib/servicing";
import { workQueue } from "@/lib/work-queue";
import { attentionItems } from "@/lib/attention";
import { answerDueOn, appraisalStage, belowPlan, loanAt, orderChecks, orderProblem, plannedValues, reviewProblem, valueToKeep } from "@/lib/appraisals";
import { agentChecks, agentLinkState, agentPolicyProblem, agentView, clauseFor, failedChecks, type AgentPolicyInput } from "@/lib/insurance-agent";
import { policiesOf } from "@/lib/insurance";
import { fillReply, MAX_VIEWS, NO_FILTERS, replyProblem, viewProblem } from "@/lib/staff-tools";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, ...(organizationId ? { organizationId } : {}) });
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return { after: reducer(b, result.action), action: result.action };
};
const deal = (b: Book, id: string) => b.deals.find((item) => item.id === id)!;
const processor = person("proc", ["PROCESSOR"]);
const servicer = person("svc", ["SERVICER"]);
const borrowerOf = (b: Book, id: string) => person(deal(b, id).borrowerId, ["BORROWER"]);
const day = serviceDay(demoBook());

describe("the appraisal tracker", () => {
  it("orders nothing until the terms are accepted, the loan fits the rules and nobody is on the sanctions list", () => {
    const b = demoBook();
    expect(orderChecks(deal(b, "d8")).every((item) => item.ok)).toBe(true);
    expect(orderChecks(deal(b, "d4")).find((item) => item.key === "terms")?.ok).toBe(false);
    expect(orderChecks(deal(b, "d6")).find((item) => item.key === "ofac")?.ok).toBe(false);
    const order = { t: "orderAppraisal" as const, dealId: "d4", on: day, firm: "Sample Appraisal Group (FAKE)", fee: 650, dueOn: addDays(day, 10), by: "" };
    expect(check(b, processor, order)).toHaveProperty("error");
    expect(check(b, borrowerOf(b, "d8"), { ...order, dealId: "d8" })).toHaveProperty("error");
    expect(check(b, servicer, { ...order, dealId: "d8" })).toHaveProperty("error");
    const { after } = run(b, processor, { ...order, dealId: "d8" });
    expect(deal(after, "d8").appraisal?.ordered).toMatchObject({ firm: "Sample Appraisal Group (FAKE)", fee: 650, by: "proc name" });
    expect(orderProblem(deal(after, "d8"), { on: day, firm: "Other", fee: 0, dueOn: day }, day)).toMatch(/already ordered/);
    // The borrower and their broker hear it's ordered and when to expect it.
    const alerts = alertsFor(b, after, run(b, processor, { ...order, dealId: "d8" }).action);
    expect(alerts.find((alert) => alert.to === "borrower" && alert.event === "appraisal.update")?.body).toMatch(/expect the report by/);
  });

  it("says what value keeps the loan as it is", () => {
    const b = demoBook();
    const d8 = deal(b, "d8");
    const keep = valueToKeep(d8);
    expect(keep.loan).toBe(evaluate(d8.app).noteAmount);
    expect(keep.asIs).toBeLessThanOrEqual(plannedValues(d8).asIs);
    expect(keep.arv).toBeLessThanOrEqual(d8.app.arv);
    expect(loanAt(d8, { asIs: keep.asIs, arv: d8.app.arv }).noteAmount).toBeGreaterThanOrEqual(keep.loan - 0.5);
    expect(loanAt(d8, { asIs: plannedValues(d8).asIs, arv: keep.arv }).noteAmount).toBeGreaterThanOrEqual(keep.loan - 0.5);
    expect(loanAt(d8, { asIs: plannedValues(d8).asIs, arv: keep.arv! - 5_000 }).noteAmount).toBeLessThan(keep.loan);
  });

  it("tells the borrower plainly whether a report under plan changes their loan", () => {
    const b = run(demoBook(), processor, { t: "orderAppraisal", dealId: "d8", on: day, firm: "Sample Appraisal Group (FAKE)", fee: 650, dueOn: addDays(day, 10), by: "" }).after;
    const d8 = deal(b, "d8");
    const keep = valueToKeep(d8);
    const report = (arv: number) => { const done = run(b, processor, { t: "appraisalDelivered", dealId: "d8", on: day, asIs: d8.app.purchasePrice, arv, by: "" }); return alertsFor(b, done.after, done.action).find((alert) => alert.to === "borrower")!.body; };
    expect(keep.arv).toBeLessThan(d8.app.arv);
    expect(report(d8.app.arv)).toMatch(/supports your loan as planned/);
    expect(report(keep.arv!)).toMatch(/under what the loan was sized on, but your loan stays at/);
    expect(report(keep.arv! - 20_000)).toMatch(/the loan can be up to/);
  });

  it("moves the report's day only with a reason the borrower sees", () => {
    const b = run(demoBook(), processor, { t: "orderAppraisal", dealId: "d8", on: day, firm: "Sample Appraisal Group (FAKE)", fee: 650, dueOn: addDays(day, 10), by: "" }).after;
    expect(check(b, processor, { t: "appraisalDates", dealId: "d8", dueOn: addDays(day, 14), reason: "", by: "" })).toHaveProperty("error");
    const moved = run(b, processor, { t: "appraisalDates", dealId: "d8", inspectionOn: addDays(day, 3), dueOn: addDays(day, 14), reason: "The appraiser is booked until Monday. (FAKE)", by: "" });
    expect(deal(moved.after, "d8").appraisal).toMatchObject({ inspectionOn: addDays(day, 3), ordered: { dueOn: addDays(day, 14) }, moves: [{ from: addDays(day, 10), to: addDays(day, 14) }] });
    const alert = alertsFor(b, moved.after, moved.action).find((item) => item.to === "borrower")!;
    expect(alert.body).toMatch(/visit .* is set/);
    expect(alert.body).toMatch(/booked until Monday/);
  });

  it("lets the borrower question a low value once, with up to five recent sales", () => {
    const b = demoBook();
    const d3 = deal(b, "d3");
    expect(belowPlan(d3)).toBe(true);
    expect(appraisalStage(d3.appraisal, day)).toBe("in");
    const borrower = borrowerOf(b, "d3");
    const sale = { address: "40 Sample Biscayne Way (FAKE)", price: 2_310_000, soldOn: addDays(day, -60), note: "Same block" };
    const ask = { t: "askValueReview" as const, dealId: "d3", reason: "The report left out two renovated sales on the same block. (FAKE)", sales: [sale, { ...sale, address: "44 Sample Biscayne Way (FAKE)" }], by: "" };
    expect(reviewProblem(d3, { ...ask, sales: [{ ...sale, soldOn: addDays(day, -400) }] }, day)).toMatch(/last 12 months/);
    expect(reviewProblem(d3, { ...ask, sales: Array(6).fill(sale) }, day)).toMatch(/up to 5/);
    expect(parseAction({ ...ask, sales: Array(6).fill(sale) })).toBeNull();
    expect(check(b, person("someone-else", ["BORROWER"]), ask)).toHaveProperty("error");
    const asked = run(b, borrower, ask);
    expect(deal(asked.after, "d3").appraisal?.review).toMatchObject({ by: `${borrower.id} name`, sales: [{ price: 2_310_000 }, {}] });
    expect(check(asked.after, borrower, ask)).toHaveProperty("error");
    // The team hears, with the sales, and the queue holds it until it's answered.
    expect(alertsFor(b, asked.after, asked.action).find((alert) => alert.to === "team")?.body).toMatch(/40 Sample Biscayne Way/);
    const queue = workQueue(asked.after, { id: "" }, new Date(`${day}T15:00:00Z`));
    expect([...queue.team, ...queue.mine].find((entry) => entry.key === "valuereview:d3")?.label).toMatch(/promised by/);
    // A borrower whose report supports the loan has nothing to question.
    expect(reviewProblem(deal(b, "d15"), ask, day)).toMatch(/supports the loan/);
    const answered = run(asked.after, processor, { t: "answerValueReview", dealId: "d3", asIs: 1_150_000, arv: 2_250_000, note: "The appraiser added one of the two sales. (FAKE)", by: "" });
    expect(deal(answered.after, "d3").appraisal?.review?.answer).toMatchObject({ asIs: 1_150_000, arv: 2_250_000 });
    expect(alertsFor(asked.after, answered.after, answered.action).find((alert) => alert.to === "borrower")?.body).toMatch(/\$2,250,000\.00 after the work/);
    // Thanksgiving and the Friday after are Florida holidays.
    expect(answerDueOn("2026-11-20")).toBe("2026-12-08");
  });

  it("shows the borrower the appraisal without the team's names, and hides it from a loan's would-be buyers", () => {
    const b = demoBook();
    const seen = scopeBook(b, borrowerOf(b, "d7")).deals.find((item) => item.id === "d7")!;
    expect(seen.appraisal?.ordered.by).toBe("");
    expect(seen.appraisal?.delivered?.by).toBe("");
    expect(seen.appraisal?.review?.answer?.by).toBe("");
    expect(seen.appraisal?.review?.by).toBe("Taylor Fakename (FAKE)");
  });
});

describe("the insurance agent's link", () => {
  const good = (b: Book): AgentPolicyInput => ({ kind: "hazard", carrier: "Sample Coastal Insurance (FAKE)", policy: "HO-1", effectiveOn: deal(b, "d8").closingDate, expiresOn: addDays(deal(b, "d8").closingDate, 366), coverage: 300_000, windIncluded: true, namedInsured: `${deal(b, "d8").entityName}`, clause: clauseFor(deal(b, "d8").loanNumber) });

  it("checks the clause, the insured, wind, coverage and dates", () => {
    const b = demoBook();
    const view = agentView(deal(b, "d8"));
    expect(failedChecks(agentChecks(view, good(b), day))).toEqual([]);
    // The seeded binder leaves out the loan number and wind, and covers less than the loan.
    const seeded = deal(b, "d8").insurance!.renewals![0];
    expect(seeded.via).toBe("agent");
    expect(failedChecks(seeded.checks!).map((item) => item.key).sort()).toEqual(["clause", "wind"]);
    expect(seeded.checks!.find((item) => item.key === "coverage")).toMatchObject({ ok: false, soft: true });
    const off = agentChecks(view, { ...good(b), namedInsured: "Someone Else LLC", clause: "LendHous", effectiveOn: addDays(deal(b, "d8").closingDate, 2), expiresOn: addDays(deal(b, "d8").closingDate, 100) }, day);
    expect(failedChecks(off).map((item) => item.key).sort()).toEqual(["clause", "ends", "insured", "starts"]);
    expect(off.find((item) => item.key === "clause")?.text).toMatch(/ISAOA.*ATIMA.*loan number/);
    // "Sample Flips, L.L.C." reads the same as "Sample Flips LLC".
    expect(agentChecks(view, { ...good(b), namedInsured: `${deal(b, "d8").entityName.replace(/ LLC/, ", L.L.C.")}` }, day).find((item) => item.key === "insured")?.ok).toBe(true);
    expect(agentPolicyProblem(view, { ...good(b), clause: "" })).toMatch(/mortgagee clause/);
    expect(agentPolicyProblem(view, { ...good(b), kind: "flood" })).toMatch(/NFIP or a private/);
  });

  it("on a funded loan, wants the new policy to start before the old one ends", () => {
    const b = demoBook();
    const d2 = deal(b, "d2");
    const current = policiesOf(d2).find((item) => item.kind === "hazard")!;
    const view = agentView(d2);
    expect(view.funded).toBe(true);
    const renewal = { ...good(b), namedInsured: d2.entityName, clause: clauseFor(d2.loanNumber), effectiveOn: addDays(current.expiresOn, 3), expiresOn: addDays(current.expiresOn, 400) };
    expect(agentChecks(view, renewal, day).find((item) => item.key === "starts")).toMatchObject({ ok: false });
    expect(agentChecks(view, { ...renewal, effectiveOn: current.expiresOn }, day).find((item) => item.key === "starts")?.ok).toBe(true);
  });

  it("asks an NFIP flood policy for the lower of the loan and the program's limit", () => {
    const b = demoBook();
    const view = { ...agentView(deal(b, "d8")), noteAmount: 400_000 };
    const flood = { ...good(b), kind: "flood" as const, program: "nfip" as const, coverage: 250_000 };
    expect(agentChecks(view, flood, day).find((item) => item.key === "coverage")?.ok).toBe(true);
    expect(agentChecks(view, { ...flood, program: "private" }, day).find((item) => item.key === "coverage")).toMatchObject({ ok: false, soft: true });
  });

  it("records what the agent sends only from the server, for the team to accept or send back", () => {
    const b = demoBook();
    const actor = person("insurance-link:d8", []);
    const action: BookAction = { t: "agentPolicy", dealId: "d8", renewalId: "ren-test", policy: good(b), checks: agentChecks(agentView(deal(b, "d8")), good(b), day), fileName: "Binder 2 (FAKE).pdf", documentId: "doc-test", by: "Dana Agent (FAKE) (insurance agent)" };
    expect(check(b, actor, action)).toHaveProperty("error");
    expect(parseAction(action)).toBeNull();
    const sent = run(b, actor, action, true);
    const renewals = deal(sent.after, "d8").insurance!.renewals!;
    expect(renewals.find((item) => item.id === "ren-demo-8")).toMatchObject({ status: "returned", decided: { note: /newer copy/ } });
    expect(renewals.find((item) => item.id === "ren-test")).toMatchObject({ status: "submitted", via: "agent", coverage: 300_000, windIncluded: true, effectiveOn: good(b).effectiveOn });
    expect(deal(sent.after, "d8").docs.find((doc) => doc.id === "insurance")).toMatchObject({ status: "uploaded", documentId: "doc-test" });
    expect(alertsFor(b, sent.after, sent.action).map((alert) => alert.to).sort()).toEqual(["borrower", "team"]);
    const accepted = run(sent.after, processor, { t: "decideRenewal", dealId: "d8", renewalId: "ren-test", accept: true, mortgagee: true, windIncluded: true, note: "", by: "" });
    expect(policiesOf(deal(accepted.after, "d8")).find((item) => item.kind === "hazard")).toMatchObject({ coverage: 300_000, windIncluded: true, mortgagee: true, documentId: "doc-test" });
    expect(deal(accepted.after, "d8").docs.find((doc) => doc.id === "insurance")?.status).toBe("accepted");
    const returned = run(sent.after, processor, { t: "decideRenewal", dealId: "d8", renewalId: "ren-test", accept: false, mortgagee: false, note: "Add the loan number to the clause.", by: "" });
    expect(deal(returned.after, "d8").docs.find((doc) => doc.id === "insurance")).toMatchObject({ status: "rejected", teamNote: "Add the loan number to the clause." });
  });

  it("puts an agent's policy on the team's queue apart from the borrower's renewals", () => {
    const b = demoBook();
    const items = attentionItems(b, 0);
    expect(items.find((item) => item.key === "agent-policies")).toMatchObject({ count: 1, href: expect.stringContaining("d8") });
    expect(items.find((item) => item.key === "renewals")).toBeUndefined();
    const queue = workQueue(b, { id: "" }, new Date(`${day}T15:00:00Z`));
    expect([...queue.team, ...queue.mine].find((entry) => entry.key === "renewal:d8")).toMatchObject({ label: "Check a policy from the insurance agent", href: "/admin/deals/d8?tab=Closing" });
  });

  it("works only while the loan is open, and shows the agent nothing personal about the borrower", () => {
    const b = demoBook();
    const d8 = deal(b, "d8");
    const link = { sentTo: "Dana Agent (FAKE)", email: "dana@sample.test", sentBy: "Pat at LendHous", sentAt: "2026-10-30T12:00:00Z", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), status: "open" as const };
    expect(agentLinkState({ ...d8, insuranceLink: link })).toBe("open");
    expect(agentLinkState({ ...d8, insuranceLink: { ...link, status: "off" } })).toBe("off");
    expect(agentLinkState({ ...d8, insuranceLink: { ...link, expiresAt: "2020-01-01T00:00:00Z" } })).toBe("expired");
    expect(agentLinkState({ ...d8, status: "paid_off", insuranceLink: link })).toBe("closed");
    expect(JSON.stringify(agentView(d8))).not.toContain(d8.borrowerName);
    for (const t of ["openInsuranceLink", "turnOffInsuranceLink"] as const) expect(check(b, processor, t === "openInsuranceLink" ? { t, dealId: "d8", sentTo: "x", email: "x@y.z", sentBy: "x", expiresAt: link.expiresAt } : { t, dealId: "d8" })).toHaveProperty("error");
  });
});

describe("staff speed-ups", () => {
  it("fills a saved reply's blanks for the loan and the person sending it", () => {
    const b = demoBook();
    const d3 = deal(b, "d3");
    const text = fillReply("Hi {first name}, {loan number} closes {closing date}. {my name}", d3, "Pat Processor (FAKE)");
    expect(text).toBe(`Hi Jordan, ${d3.loanNumber} closes ${new Date(`${d3.closingDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}. Pat Processor`);
    expect(b.savedReplies?.length).toBe(3);
  });

  it("keeps the team's replies to the team, and each name once", () => {
    const b = demoBook();
    const save = { t: "saveReply" as const, replyId: "reply-new", title: "Wire warning", text: "Hi {first name}, we never email wire instructions.", by: "" };
    expect(check(b, borrowerOf(b, "d3"), save)).toHaveProperty("error");
    const saved = run(b, processor, save).after;
    expect(saved.savedReplies?.find((item) => item.id === "reply-new")).toMatchObject({ by: "proc name", title: "Wire warning" });
    expect(replyProblem(saved.savedReplies!, { ...save, replyId: "reply-other", title: "wire warning" })).toMatch(/already/);
    expect(scopeBook(saved, borrowerOf(saved, "d3")).savedReplies).toEqual([]);
    expect(run(saved, processor, { t: "deleteReply", replyId: "reply-new" }).after.savedReplies?.some((item) => item.id === "reply-new")).toBe(false);
  });

  it("saves pipeline views as the person's own, whatever the browser says", () => {
    const b = demoBook();
    const filters = { ...NO_FILTERS, product: "dscr" as const, stage: "conditions" as const };
    const saved = run(b, processor, { t: "savePipelineView", viewId: "view-1", name: "DSCR in conditions", filters, ownerId: "someone-else" }).after;
    expect(saved.pipelineViews).toEqual([expect.objectContaining({ id: "view-1", ownerId: "proc", filters })]);
    expect(check(saved, servicer, { t: "deletePipelineView", viewId: "view-1", ownerId: "proc" })).toHaveProperty("error");
    expect(run(saved, processor, { t: "deletePipelineView", viewId: "view-1", ownerId: "" }).after.pipelineViews).toEqual([]);
    const full = Array.from({ length: MAX_VIEWS }, (_, index) => ({ id: `v${index}`, name: `View ${index}`, ownerId: "proc", filters, at: "" }));
    expect(viewProblem(full, { viewId: "v-new", name: "One more", ownerId: "proc" })).toMatch(/up to 12/);
    expect(viewProblem(full, { viewId: "v-new", name: "One more", ownerId: "svc" })).toBeNull();
    expect(parseAction({ t: "savePipelineView", viewId: "v", name: "x", ownerId: "", filters: { ...filters, stage: "<script>" } })).toBeNull();
  });

  it("takes files on messages only from the upload route", () => {
    const b = demoBook();
    const borrower = borrowerOf(b, "d3");
    const message: BookAction = { t: "sendMessage", dealId: "d3", from: "", side: "borrower", text: "Here's the survey.", files: [{ name: "Survey.pdf", documentId: "doc-x" }] };
    expect(run(b, borrower, message).after.messages.at(-1)?.files).toBeUndefined();
    expect(run(b, borrower, message, true).after.messages.at(-1)).toMatchObject({ side: "borrower", files: [{ name: "Survey.pdf", documentId: "doc-x" }] });
    expect(run(b, borrower, { ...message, text: "" }, true).after.messages.at(-1)?.text).toBe("");
    expect(check(b, borrower, { ...message, text: " " })).toHaveProperty("error");
  });
});
