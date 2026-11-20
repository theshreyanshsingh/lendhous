import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, serviceDay, type Book, type BookAction } from "@/lib/book";
import { DEFAULT_LIBRARY, templatesFor } from "@/lib/conditions";
import type { Deal } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { mitigationCredits, mitigationNote, sellerFloodFlags, type MitigationInput } from "@/lib/wind-mitigation";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const form = (change: Partial<MitigationInput> = {}): MitigationInput => ({ inspectedOn: "2024-03-01", inspector: "Sample Inspections (FAKE), HI1234", builtToCode: false, roofCovering: true, roofDeck: "C", roofToWall: "clips", roofShape: "hip", swr: true, openings: "some", ...change });
const stamp = { by: "x", at: "2026-11-01T12:00:00Z" };

describe("wind mitigation and flood history (rank 15)", () => {
  const b = demoBook();
  const today = serviceDay(b);
  const rental = b.deals.find((deal) => deal.app.product === "dscr")!;
  const purchase = b.deals.find((deal) => deal.app.purpose === "purchase")!;

  it("lists the credits on the form and says when it runs out", () => {
    expect(mitigationCredits({ ...form(), ...stamp })).toEqual(["Roof covering meets the Florida Building Code", "Roof deck attachment C", "Roof-to-wall clips", "Hip roof", "Secondary water resistance"]);
    expect(mitigationCredits({ ...form({ roofCovering: false, roofDeck: "A", roofToWall: "toe_nails", roofShape: "other", swr: false, openings: "none" }), ...stamp })).toEqual([]);
    const insured = (change: Partial<MitigationInput>) => ({ ...rental, insurance: { policies: [], mitigation: { ...form(change), ...stamp } } });
    expect(mitigationNote(insured({}), "2026-11-20")).toMatchObject({ tone: "good", text: expect.stringMatching(/^5 wind credits on the form, good to March 1, 2029/) });
    expect(mitigationNote(insured({ inspectedOn: "2020-06-01" }), "2026-11-20")).toMatchObject({ tone: "warn", text: expect.stringMatching(/ran out June 1, 2025/) });
    expect(mitigationNote({ ...rental, insurance: { policies: [] } }, today)).toMatchObject({ tone: "note", text: expect.stringMatching(/627\.0629/) });
    expect(mitigationNote({ ...rental, app: { ...rental.app, product: "fix_flip" }, insurance: { policies: [] } }, today)).toBeNull();
  });

  it("flags the seller's yes answers, and a flood history outside the flood zone", () => {
    const disclosed = (sellerFlood: NonNullable<Deal["insurance"]>["sellerFlood"], sfha = false): Pick<Deal, "app" | "insurance"> => ({ app: purchase.app, insurance: { policies: [], sellerFlood, flood: { sfha, zone: sfha ? "AE" : "X", ...stamp } } });
    expect(sellerFloodFlags({ app: purchase.app, insurance: { policies: [] } })).toEqual([{ level: "note", text: expect.stringMatching(/isn't recorded/) }]);
    expect(sellerFloodFlags(disclosed({ given: true, flooding: false, claim: false, assistance: false, ...stamp }))).toEqual([]);
    expect(sellerFloodFlags(disclosed({ given: false, ...stamp }))).toEqual([{ level: "warn", text: expect.stringMatching(/didn't give the flood disclosure/) }]);
    const flags = sellerFloodFlags(disclosed({ given: true, flooding: true, claim: true, assistance: false, ...stamp }));
    expect(flags.map((flag) => flag.text)).toEqual([expect.stringMatching(/^The seller knows of flooding that damaged it and filed a flood insurance claim\. /), expect.stringMatching(/isn't in a special flood hazard area/)]);
    expect(sellerFloodFlags(disclosed({ given: true, flooding: true, claim: false, assistance: false, ...stamp }, true))).toHaveLength(1);
    expect(sellerFloodFlags({ app: { ...purchase.app, purpose: "refi_rt" }, insurance: { policies: [] } })).toEqual([]);
  });

  it("lets the team record both, and refuses what doesn't fit", () => {
    const staff = person("u-proc", ["PROCESSOR"]);
    const loan = b.deals.find((deal) => deal.status === "funded" && deal.app.purpose === "purchase")!;
    const saveForm: BookAction = { t: "saveMitigation", dealId: loan.id, form: form(), by: "" };
    expect(check(b, staff, saveForm)).toHaveProperty("action");
    expect(check(b, staff, { ...saveForm, form: form({ inspectedOn: "2099-01-01" }) } as BookAction)).toEqual({ error: "Enter the day of the inspection, not after today." });
    expect(check(b, person(loan.borrowerId, ["BORROWER"]), saveForm)).toHaveProperty("error");
    const half: BookAction = { t: "saveSellerFlood", dealId: loan.id, disclosure: { given: true, flooding: true }, by: "" };
    expect(check(b, staff, half)).toEqual({ error: "Answer each of the three questions as the seller did." });
    let next = reducer(b, { ...saveForm, by: "Pat" });
    next = reducer(next, { t: "saveSellerFlood", dealId: loan.id, disclosure: { given: true, flooding: false, claim: true, assistance: false }, by: "Pat" });
    const saved = next.deals.find((deal) => deal.id === loan.id)!.insurance!;
    expect(saved.mitigation).toMatchObject({ roofShape: "hip", by: "Pat" });
    expect(saved.sellerFlood).toMatchObject({ given: true, claim: true, by: "Pat" });
    expect(saved.policies.length).toBeGreaterThan(0);
  });

  it("asks a long-term rental for the landlord's flood disclosure, not a short-term one", () => {
    expect(templatesFor(DEFAULT_LIBRARY, rental.app).map((item) => item.id)).toContain("std-lease-flood");
    expect(templatesFor(DEFAULT_LIBRARY, { ...rental.app, rentalType: "short_term" }).map((item) => item.id)).not.toContain("std-lease-flood");
    expect(templatesFor(DEFAULT_LIBRARY, { ...rental.app, product: "bridge" }).map((item) => item.id)).not.toContain("std-lease-flood");
  });
});
