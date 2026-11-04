import { describe, expect, it } from "vitest";
import { DEFAULT_CONDITIONS, expiryFor, letterNumber, letterProblem, letterState, type LetterDetails } from "@/lib/letters";

const letter = (changes: Partial<LetterDetails> = {}): LetterDetails => ({ kind: "pre_approval", name: "Lola Letter", email: "", entityName: "", product: "fix_flip", maxPurchasePrice: 400_000, maxLoan: 340_000, propertyAddress: "", conditions: DEFAULT_CONDITIONS, validDays: 30, ...changes });

describe("pre-approval and proof-of-funds letters", () => {
  it("need a name, amounts, a validity of 7 to 90 days and a condition", () => {
    expect(letterProblem(letter())).toBeNull();
    expect(letterProblem(letter({ name: " " }))).toMatch(/name/);
    expect(letterProblem(letter({ maxLoan: 0 }))).toMatch(/most LendHous would lend/);
    expect(letterProblem(letter({ maxPurchasePrice: -5 }))).toMatch(/most they can pay/);
    expect(letterProblem(letter({ validDays: 120 }))).toMatch(/7 to 90 days/);
    expect(letterProblem(letter({ validDays: 3 }))).toMatch(/7 to 90 days/);
    expect(letterProblem(letter({ conditions: [" "] }))).toMatch(/condition/);
    expect(letterProblem(letter({ email: "not an email" }))).toMatch(/email/);
  });
  it("stand until their last day, unless withdrawn", () => {
    expect(expiryFor("2026-11-04", 30)).toBe("2026-12-04");
    expect(expiryFor("2026-12-15", 30)).toBe("2027-01-14");
    expect(letterState({ expiresOn: "2026-12-04" }, "2026-12-04")).toBe("valid");
    expect(letterState({ expiresOn: "2026-12-04" }, "2026-12-05")).toBe("expired");
    expect(letterState({ expiresOn: "2026-12-04", revokedAt: "2026-11-10T12:00:00Z" }, "2026-11-11")).toBe("revoked");
  });
  it("are numbered by kind and year", () => {
    expect(letterNumber("pre_approval", "2026", 7)).toBe("PA-2026-0007");
    expect(letterNumber("proof_of_funds", "2027", 12)).toBe("PF-2027-0012");
  });
});
