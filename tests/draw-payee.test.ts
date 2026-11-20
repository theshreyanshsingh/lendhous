import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import { drawHolds } from "@/lib/lien-law";
import { drawStatusForContractor, payeeEmail, payeeProblem, payeeWords } from "@/lib/draw-payee";
import { can, type Permission } from "@/lib/permissions";

const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);

describe("who a draw is paid to (rank 21)", () => {
  it("pays a contractor only once it's named on the lien file", () => {
    expect(payeeProblem({ lienFile: undefined }, "borrower")).toBeNull();
    expect(payeeProblem({ lienFile: undefined }, "joint")).toMatch(/Add the contractor on the Closing tab first/);
    expect(payeeProblem({ lienFile: { contractor: "Sample Construction (FAKE)", notices: [] } }, "contractor")).toBeNull();
    expect(payeeWords("joint", "Sample Construction (FAKE)")).toBe("the borrower and Sample Construction (FAKE) jointly");
  });

  it("records the payee on the release, and the access rules agree", () => {
    const b = demoBook();
    const deal = b.deals.find((item) => item.id === "d2")!;
    // Approved, and released past its lien-law holds by an owner, as the app allows with a reason.
    const ready = (draw: Book["draws"][number]) => ({ ...draw, status: "approved" as const, approved: 20_000 });
    const held = drawHolds(deal, ready(b.draws.find((draw) => draw.id === "draw-1")!), serviceDay(b));
    const approved: Book = { ...b, draws: b.draws.map((draw) => (draw.id === "draw-1" ? { ...ready(draw), override: { by: "Olivia", at: "x", reason: "Waivers in hand (test)", holds: held } } : draw)) };
    const owner: Viewer = { id: "own", name: "Olivia", roleCodes: ["ADMIN_OWNER"] };
    const noContractor: Book = { ...approved, deals: approved.deals.map((deal) => (deal.id === "d2" ? { ...deal, lienFile: undefined } : deal)) };
    expect(check(noContractor, owner, { t: "releaseDraw", drawId: "draw-1", payee: "contractor" })).toEqual({ error: "Add the contractor on the Closing tab first, so the payment is made out to the right name." });
    const next = reducer(approved, { t: "releaseDraw", drawId: "draw-1", payee: "joint" });
    const released = next.draws.find((draw) => draw.id === "draw-1")!;
    expect(released).toMatchObject({ status: "funded", payee: "joint" });
    expect(reducer(approved, { t: "releaseDraw", drawId: "draw-1" }).draws.find((draw) => draw.id === "draw-1")).toMatchObject({ status: "funded" });
    expect(reducer(approved, { t: "releaseDraw", drawId: "draw-1" }).draws.find((draw) => draw.id === "draw-1")!.payee).toBeUndefined();
  });

  it("tells the contractor where the draw stands, and that it's paid, without amounts on the link", () => {
    expect(drawStatusForContractor({ status: "inspecting" })).toBe("The draw your photos were for is being reviewed.");
    expect(drawStatusForContractor({ status: "funded", fundedAt: "2026-11-20T15:00:00Z", payee: "joint" })).toBe("The draw your photos were for was released on November 20, 2026, paid to you and the borrower jointly.");
    expect(drawStatusForContractor({ status: "funded", fundedAt: "2026-11-20T15:00:00Z" })).toMatch(/paid to the borrower\.$/);
    expect(drawStatusForContractor({ status: "funded", fundedAt: "2026-11-20T15:00:00Z", payee: "contractor" })).not.toMatch(/\$/);
    expect(payeeEmail({ approved: 20_000, fee: 100, fundedAt: "2026-11-20T15:00:00Z", payee: "contractor" }, { address: "456 Placeholder Ave", city: "Fort Lauderdale" }, "Sam")).toMatch(/^Hello Sam,\n\nLendHous released the draw for the work at 456 Placeholder Ave, Fort Lauderdale on November 20, 2026: \$19,900\.00, made out to you\./);
  });
});
