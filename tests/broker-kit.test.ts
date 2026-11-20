import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { BROKER_COURSE, courseProgress, lessonProblem } from "@/lib/broker-kit";
import { PROTECTION_MONTHS } from "@/lib/brokers";
import { DEMO_BROKER_ID } from "@/lib/mockData";
import { can, type Permission } from "@/lib/permissions";
import { embedPath, embedSnippet } from "@/lib/quote-funnel";

const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const broker: Viewer = { id: "u-brk", name: "Bea Broker", roleCodes: ["BROKER"], organizationId: DEMO_BROKER_ID } as Viewer;

describe("the broker kit (rank 25)", () => {
  it("teaches from the app's own rules, with one question per lesson", () => {
    expect(BROKER_COURSE).toHaveLength(5);
    expect(BROKER_COURSE.find((lesson) => lesson.id === "deals")!.check.options[1]).toBe(`${PROTECTION_MONTHS} months`);
    for (const lesson of BROKER_COURSE) expect(lesson.check.options[lesson.check.answer]).toBeTruthy();
    expect(lessonProblem("fees", 0)).toBeNull();
    expect(lessonProblem("fees", 1)).toMatch(/^Not quite/);
    expect(lessonProblem("nope", 0)).toBe("That lesson isn't in the course.");
  });

  it("records a lesson passed by the brokerage's own people, and the course finished", () => {
    let b = demoBook();
    const pass = (lessonId: string): BookAction => ({ t: "passBrokerLesson", brokerId: DEMO_BROKER_ID, lessonId, answer: BROKER_COURSE.find((lesson) => lesson.id === lessonId)!.check.answer });
    expect(check(b, broker, pass("lending"))).toHaveProperty("action");
    expect(check(b, broker, { ...pass("lending"), answer: 0 } as BookAction)).toEqual({ error: "Not quite. Read the lesson again and try once more." });
    expect(check(b, { id: "own", name: "Olivia", roleCodes: ["ADMIN_OWNER"] }, pass("lending"))).toHaveProperty("error");
    for (const lesson of BROKER_COURSE) b = reducer(b, pass(lesson.id));
    const firm = b.brokers.find((item) => item.id === DEMO_BROKER_ID)!;
    expect(courseProgress(firm)).toEqual({ done: 5, total: 5, finished: true });
    expect(firm.training?.finishedAt).toBeTruthy();
    expect(check(b, broker, pass("draws"))).toEqual({ error: "That lesson is already passed." });
  });

  it("puts the broker's brand on its widget only when asked, and only with its referral", () => {
    expect(embedPath({ ref: "demobrkr", brand: true })).toBe("/embed/quote?ref=demobrkr&brand=1");
    expect(embedPath({ brand: true })).toBe("/embed/quote");
    expect(embedSnippet("https://lendhous.example", { ref: "demobrkr", brand: true })).toContain('src="https://lendhous.example/embed/quote?ref=demobrkr&brand=1"');
  });
});
