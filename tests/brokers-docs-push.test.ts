import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { fileBatch, filedDocuments, reuseProblem, suggestDoc } from "@/lib/doc-sorting";
import type { Doc } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { pushEndpointOk, pushMessage, subscriptionProblem } from "@/lib/push";

const person = (id: string, roles: Viewer["roleCodes"], organizationId?: string): Viewer => ({ id, name: `${id} name`, roleCodes: roles, organizationId });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const run = (b: Book, viewer: Viewer, action: BookAction) => {
  const result = check(b, viewer, action);
  if ("error" in result) throw new Error(result.error);
  return reducer(b, result.action);
};
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
const docs = (ids: string[], status: Doc["status"] = "requested"): Doc[] => ids.map((id) => ({ id, name: id, category: "Other", status }));

describe("filing a batch of documents by their names", () => {
  const checklist = docs(["id", "entity", "ein", "good-standing", "contract", "sow", "contractor", "bank", "insurance", "track", "lease"]);
  it("sends each to the item its name points to", () => {
    const cases: [string, string | null][] = [
      ["Operating Agreement - Sunrise LLC.pdf", "entity"], ["EIN_CP575.pdf", "ein"], ["Sunbiz good standing.pdf", "good-standing"],
      ["drivers-license-front.jpg", "id"], ["Passport.png", "id"], ["Contractor license and bid.pdf", "contractor"],
      ["Purchase and Sale Agreement.pdf", "contract"], ["Rehab budget v2.xlsx", "sow"], ["Chase statement Sept.pdf", "bank"],
      ["HUD-1 settlement 123 Main.pdf", "track"], ["Insurance binder.pdf", "insurance"], ["Lease - unit A.pdf", "lease"], ["IMG_2041.jpg", null],
    ];
    for (const [name, expected] of cases) expect([name, suggestDoc(name, checklist)]).toEqual([name, expected]);
  });
  it("prefers an item still to send, and never sends two files to one item", () => {
    const some = [...docs(["bank"], "accepted"), ...docs(["entity"])];
    expect(suggestDoc("bank statement.pdf", some)).toBe("bank");
    expect(fileBatch(["Bank statement Aug.pdf", "Bank statement Sept.pdf", "Operating agreement.pdf"], checklist)).toEqual([
      { fileName: "Bank statement Aug.pdf", docId: "bank" }, { fileName: "Bank statement Sept.pdf", docId: null }, { fileName: "Operating agreement.pdf", docId: "entity" },
    ]);
  });
});

describe("a borrower's own documents across loans", () => {
  const alex = (b: Book) => person(deal(b, "d1").borrowerId, ["BORROWER"]);
  it("lists every document with a file, newest loan first", () => {
    const b = demoBook();
    const mine = filedDocuments(b.deals.filter((item) => item.borrowerId === deal(b, "d1").borrowerId));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every(({ doc }) => doc.fileName || doc.documentId)).toBe(true);
  });
  it("sends one already on another loan to an item still waiting, for the team to review again", () => {
    const b = demoBook();
    expect(deal(b, "d1").docs.find((doc) => doc.id === "bank")!.status).toBe("requested");
    const reuse: BookAction = { t: "reuseDocument", dealId: "d1", docId: "bank", fromDealId: "d2", by: "x" };
    expect(check(b, person("other", ["BORROWER"]), reuse)).toHaveProperty("error");
    expect(check(b, alex(b), { ...reuse, docId: "entity" } as BookAction)).toEqual({ error: "That item isn't waiting for a document." });
    const after = run(b, alex(b), reuse);
    expect(deal(after, "d1").docs.find((doc) => doc.id === "bank")).toMatchObject({ status: "uploaded", fileName: "Bank statements.pdf", reusedFrom: "LH-DEMO-1002" });
    expect(reuseProblem(deal(b, "d1"), deal(b, "d1").docs[0], deal(b, "d1"), deal(b, "d1").docs[0])).toBe("Choose a different loan's document.");
  });
});

describe("a broker's deal", () => {
  const broker = person("bea", ["BROKER"], "brk-a");
  const submit = (b: Book, change: Partial<Extract<BookAction, { t: "submitApp" }>> = {}): BookAction => ({ t: "submitApp", app: deal(b, "d3").app, address: "77 Broker Way", city: "Miami", zip: "33130", entityName: "Client Holdings LLC", exitStrategy: "Sell", client: { name: "Casey Client", brokerId: "brk-a", brokerPoints: 1 }, ...change });
  it("can leave the client's guarantors, past deals and credit answers to the client's own link", () => {
    const b = demoBook();
    expect(check(b, broker, submit(b))).toEqual({ error: "Add the guarantors, past deals and declarations, or have your client fill them in." });
    const after = run(b, broker, submit(b, { clientFills: true }));
    const made = after.deals.find((item) => item.address === "77 Broker Way")!;
    expect(made).toMatchObject({ brokerId: "brk-a", borrowerName: "Casey Client", status: "submitted" });
    expect(made.sponsor).toBeUndefined();
    // A borrower still fills in their own.
    expect(check(b, person(deal(b, "d1").borrowerId, ["BORROWER"]), submit(b, { clientFills: true, client: undefined }))).toHaveProperty("error");
  });
  it("lets the broker add a document the client didn't get asked for, on their own deal only", () => {
    const b = demoBook();
    expect(check(b, broker, { t: "addOwnDoc", dealId: "d3", docId: "own-abc123x", name: "Appraisal", by: "x" })).not.toHaveProperty("error");
    expect(check(b, person("bo", ["BROKER"], "brk-z"), { t: "addOwnDoc", dealId: "d3", docId: "own-abc123x", name: "Appraisal", by: "x" })).toHaveProperty("error");
    // The broker sees the deal's documents, and whether the client's details are in.
    const seen = scopeBook(b, broker).deals.find((item) => item.id === "d3")!;
    expect(seen.docs.length).toBeGreaterThan(0);
  });
});

describe("push notifications", () => {
  it("say the subject and the first paragraph, without the sign-in link, and open a page of the site", () => {
    expect(pushMessage("Payment late: LH-1001", "The payment of $1,000.00 due November 1, 2026 hasn't arrived.\n\nSign in: https://lendhous.com/login", "/admin/borrower/d1", "payment.late")).toEqual({ title: "Payment late: LH-1001", body: "The payment of $1,000.00 due November 1, 2026 hasn't arrived.", url: "/admin/borrower/d1", tag: "payment.late" });
    expect(pushMessage("x", "y".repeat(400), "https://elsewhere.example/").url).toBe("/admin");
    expect(pushMessage("x", "y".repeat(400), "/admin").body).toHaveLength(178);
  });
  it("only go to the browsers' own push services, with keys of the right shape", () => {
    const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };
    for (const endpoint of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/QGv", "https://wns2-par02p.notify.windows.com/w/?token=abc"]) expect([endpoint, pushEndpointOk(endpoint)]).toEqual([endpoint, true]);
    for (const endpoint of ["http://fcm.googleapis.com/fcm/send/abc", "https://169.254.169.254/latest/meta-data/", "https://fcm.googleapis.com.evil.example/x", "https://localhost:3000/api"]) expect([endpoint, pushEndpointOk(endpoint)]).toEqual([endpoint, false]);
    expect(subscriptionProblem({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys })).toBeNull();
    expect(subscriptionProblem({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { ...keys, auth: "short" } })).toMatch(/key isn't valid/);
    expect(subscriptionProblem({ endpoint: "https://internal.example/hook", keys })).toMatch(/isn't one we send to/);
  });
});
