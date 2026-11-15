import { describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { nextStage } from "@/lib/loan-stages";
import type { Deal, Sb264Answers } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { sb264Blocker, sb264Check, type Sb264Input } from "@/lib/sb264";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const answers = (people: Sb264Answers["people"], change: Partial<Sb264Answers> = {}): Sb264Answers => ({ people, entityCountry: "US", militaryWithin5: "unknown", sensitiveWithin10: "unknown", agricultural: false, by: "x", at: "x", ...change });
const buyer = (domicile: string, change: Partial<Sb264Answers["people"][number]> = {}) => ({ name: "Lin Sample (FAKE)", domicile, status: "other" as const, visa: "none" as const, ...change });

describe("Florida's limits on buyers from countries of concern (rank 11, SB 264)", () => {
  const b = demoBook();
  const purchase = b.deals.find((deal) => deal.app.purpose === "purchase" && deal.sponsor?.guarantors.length)!;
  const foreign: Deal = { ...purchase, sponsor: { ...purchase.sponsor!, guarantors: [{ ...purchase.sponsor!.guarantors[0], name: "Lin Sample (FAKE)", citizenship: "foreign" }] } };
  it("clears U.S. citizens and permanent residents from the application, and doesn't apply to a refinance", () => {
    expect(sb264Check(purchase)).toEqual({ state: "clear", lines: ["No buyer is a foreign principal from a country of concern."] });
    expect(sb264Check({ ...purchase, app: { ...purchase.app, purpose: "refi_rt" } })).toBeNull();
    expect(sb264Check({ ...foreign, sb264: answers([buyer("CN", { status: "permanent_resident" })]) })?.state).toBe("clear");
  });
  it("asks where a foreign buyer is domiciled, and holds clear to close until it's answered", () => {
    expect(sb264Check(foreign)).toMatchObject({ state: "answers_needed", lines: ["Say where Lin Sample (FAKE) is domiciled."] });
    const atConditions = { ...foreign, status: "conditions" as const };
    expect(nextStage(atConditions, evaluate(atConditions.app))?.blockers).toContain("Answer the SB 264 questions on buyers from countries of concern (Credit review tab)");
    expect(sb264Check({ ...foreign, sb264: answers([buyer("OTHER")]) })?.state).toBe("clear");
  });
  it("stops a buyer domiciled in China, unless the one-home exception fits", () => {
    const china = { ...foreign, sb264: answers([buyer("CN")]) };
    expect(sb264Check(china)).toMatchObject({ state: "stop", lines: [expect.stringMatching(/domiciled in China .* can't buy Florida real property \(692\.204\)/)] });
    expect(sb264Blocker(china)).toMatch(/stop this purchase/);
    const home = { ...foreign, app: { ...foreign.app, propertyType: "sfr" as const }, sb264: answers([buyer("CN", { visa: "non_tourist" })], { acres: 0.25, militaryWithin5: "no" }) };
    expect(sb264Check(home)).toMatchObject({ state: "clear", lines: [expect.stringMatching(/one-home exception/)] });
    expect(sb264Check({ ...home, sb264: { ...home.sb264, acres: 3 } })?.state).toBe("stop");
    expect(sb264Check({ ...home, sb264: { ...home.sb264, militaryWithin5: "unknown" } })?.state).toBe("stop");
    expect(sb264Check({ ...purchase, sb264: answers(answers([]).people.concat([{ name: "Owner", domicile: "US", status: "citizen", visa: "none" }]), { entityCountry: "CN" }) })?.state).toBe("stop");
  });
  it("asks about military installations and critical infrastructure for other countries of concern, and stops agricultural land", () => {
    const russia = { ...foreign, sb264: answers([buyer("RU")]) };
    expect(sb264Check(russia)).toMatchObject({ state: "answers_needed", lines: [expect.stringMatching(/from Russia: find out whether the property is within 10 miles/)] });
    expect(sb264Check({ ...russia, sb264: { ...russia.sb264, sensitiveWithin10: "no" } })?.state).toBe("clear");
    expect(sb264Check({ ...russia, sb264: { ...russia.sb264, sensitiveWithin10: "yes" } })).toMatchObject({ state: "stop", lines: [expect.stringMatching(/within 10 miles .* \(692\.203\)/)] });
    expect(sb264Check({ ...russia, sb264: { ...russia.sb264, sensitiveWithin10: "no", agricultural: true } })).toMatchObject({ state: "stop", lines: [expect.stringMatching(/agricultural land \(692\.202\)/)] });
  });
  it("staff record the answers on a purchase; borrowers don't see them", () => {
    const book: Book = { ...b, deals: b.deals.map((deal) => (deal.id === purchase.id ? foreign : deal)) };
    const input: Sb264Input = { people: [buyer("OTHER")], entityCountry: "US", militaryWithin5: "unknown", sensitiveWithin10: "unknown", agricultural: false };
    const save: BookAction = { t: "saveSb264", dealId: purchase.id, answers: input, by: "x" };
    expect(check(book, person("b", ["BORROWER"]), save)).toEqual({ error: "Your account can't do that." });
    expect(check(book, person("pat", ["PROCESSOR"]), { ...save, answers: { ...input, entityCountry: "ZZ" } })).toEqual({ error: "Say where the borrowing entity is organized or run from." });
    const result = check(book, person("pat", ["PROCESSOR"]), save);
    if ("error" in result) throw new Error(result.error);
    const after = reducer(book, result.action);
    expect(after.deals.find((deal) => deal.id === purchase.id)!.sb264).toMatchObject({ people: [{ domicile: "OTHER" }], by: "pat name" });
    expect(scopeBook(after, { id: purchase.borrowerId, name: "b", roleCodes: ["BORROWER"] }).deals.find((deal) => deal.id === purchase.id)?.sb264).toBeUndefined();
  });
});
