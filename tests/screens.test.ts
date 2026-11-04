import { describe, expect, it } from "vitest";
import { attentionItems } from "@/lib/attention";
import { parseAction } from "@/lib/book-actions";
import { demoBook, reducer } from "@/lib/book";
import { evaluate } from "@/lib/engine";
import { closingIn, shortDay } from "@/lib/format";
import { nextStage } from "@/lib/loan-stages";
import { dueOf } from "@/lib/payoffs";

describe("dates people read", () => {
  it("shows a day as that calendar day, and a moment as the day it was in Florida", () => {
    expect(shortDay("2026-11-13")).toBe("Nov 13, 2026");
    expect(shortDay("2026-01-01")).toBe("Jan 1, 2026");
    expect(shortDay("2026-11-04T03:30:00.000Z")).toBe("Nov 3, 2026");
    expect(shortDay("")).toBe("");
    expect(shortDay(undefined)).toBe("");
    expect(shortDay("not a date")).toBe("not a date");
  });
  it("says how far off a closing is", () => {
    expect(closingIn("2026-11-30", "2026-11-04")).toBe("26 days to go");
    expect(closingIn("2026-11-05", "2026-11-04")).toBe("tomorrow");
    expect(closingIn("2026-11-04", "2026-11-04")).toBe("today");
    expect(closingIn("2026-11-01", "2026-11-04")).toBe("3 days past");
  });
});

describe("needs attention", () => {
  const book = demoBook();
  const items = attentionItems(book, 2);
  it("puts the legal deadlines first, then money, then reviews", () => {
    const keys = items.map((item) => item.key);
    expect(keys.indexOf("payoffs")).toBe(0);
    expect(keys.indexOf("sanctions")).toBeLessThan(keys.indexOf("documents"));
    expect(keys.indexOf("funding")).toBeLessThan(keys.indexOf("applications"));
    expect(keys.indexOf("late")).toBeLessThan(keys.indexOf("leads"));
  });
  it("shows the soonest payoff letter deadline", () => {
    const soonest = book.payoffs.filter((payoff) => payoff.status === "requested").map(dueOf).sort()[0];
    expect(items.find((item) => item.key === "payoffs")?.due).toBe(soonest);
    expect(items.find((item) => item.key === "documents")?.due).toBeUndefined();
  });
});

describe("the loan page", () => {
  it("says what happens next in words", () => {
    const deal = demoBook().deals.find((item) => item.status === "underwriting")!;
    expect(nextStage(deal, evaluate(deal.app))?.next).toBe("build and send the term sheet");
  });
  it("a new application keeps the closing date the borrower asked for, or a month out", () => {
    const book = demoBook();
    const base = { t: "submitApp" as const, app: book.deals[0].app, address: "1 Close St", city: "Hollywood", zip: "33020", entityName: "Close LLC", exitStrategy: "Sell" };
    expect(reducer(book, { ...base, closingDate: "2027-01-15" }).deals[0].closingDate).toBe("2027-01-15");
    expect(reducer(book, base).deals[0].closingDate).toBe("2026-11-30");
    expect(reducer(book, { ...base, closingDate: "soon" }).deals[0].closingDate).toBe("2026-11-30");
    expect(parseAction({ ...base, closingDate: "soon" })).toBeNull();
    expect(parseAction({ ...base, closingDate: "2027-01-15" })).toMatchObject({ closingDate: "2027-01-15" });
  });
});
