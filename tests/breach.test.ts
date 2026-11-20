import { describe, expect, it } from "vitest";
import { agentLate, breachDuties, incidentProblem, nextDeadline, stepProblem, type Incident, type IncidentInput } from "@/lib/breach";
import { PERMISSIONS, can } from "@/lib/permissions";

const input = (change: Partial<IncidentInput> = {}): IncidentInput => ({ title: "Sample laptop lost (FAKE)", discoveredOn: "2026-11-01", synopsis: "A staff laptop with loan files was stolen from a car.", dataKinds: ["ssn", "dob"], floridians: 40, source: "lendhous", harm: "undetermined", ...change });
const incident = (change: Partial<Incident> = {}): Incident => ({ ...input(), id: "i1", done: {}, measures: [], by: "Owner", at: "2026-11-01T12:00:00Z", ...change });
const keys = (duties: ReturnType<typeof breachDuties>) => duties.map((duty) => duty.key);

describe("security incidents and Florida's breach notices (rank 19, Fla. Stat. 501.171)", () => {
  it("gives the people 30 days from the day it was found, 15 more for good cause, or a law enforcement delay", () => {
    const duties = breachDuties(incident(), "2026-11-20");
    expect(keys(duties)).toEqual(["individuals", "goodCause"]);
    expect(duties[0]).toMatchObject({ due: "2026-12-01", state: "due", daysLeft: 11 });
    expect(breachDuties(incident(), "2026-12-02")).toEqual([expect.objectContaining({ key: "individuals", state: "overdue" })]);
    expect(breachDuties(incident({ done: { goodCause: "2026-11-20" } }), "2026-11-20")[0]).toMatchObject({ due: "2026-12-16" });
    expect(breachDuties(incident({ lawDelay: { agency: "Sample PD (FAKE)", until: "2027-01-15" } }), "2026-11-20")[0].due).toBe("2027-01-15");
    expect(breachDuties(incident({ done: { individuals: "2026-11-25" } }), "2026-11-26")).toEqual([expect.objectContaining({ key: "individuals", state: "done", doneOn: "2026-11-25" })]);
  });

  it("adds the Department at 500 Floridians and the credit bureaus over 1,000 people told", () => {
    expect(keys(breachDuties(incident({ floridians: 499 }), "2026-11-20"))).not.toContain("department");
    expect(breachDuties(incident({ floridians: 500 }), "2026-11-20").find((duty) => duty.key === "department")).toMatchObject({ due: "2026-12-01" });
    expect(keys(breachDuties(incident({ floridians: 1000 }), "2026-11-20"))).not.toContain("bureaus");
    expect(breachDuties(incident({ floridians: 1001 }), "2026-11-20").find((duty) => duty.key === "bureaus")).toMatchObject({ state: "waiting" });
    expect(breachDuties(incident({ floridians: 800, notified: 1500 }), "2026-11-20").map((duty) => duty.key)).toContain("bureaus");
  });

  it("swaps the people's notice for a written no-harm decision sent to the Department", () => {
    const decided = incident({ harm: "unlikely", harmDecidedOn: "2026-11-10", harmReason: "The drive was encrypted and the key wasn't with it." });
    expect(breachDuties(decided, "2026-11-20")).toEqual([expect.objectContaining({ key: "determination", due: "2026-12-10" })]);
    expect(nextDeadline(decided, "2026-11-20")).toMatchObject({ key: "determination" });
    expect(incidentProblem({ ...input(), harm: "unlikely" }, "2026-11-20")).toMatch(/in writing/);
  });

  it("checks a vendor told LendHous within 10 days, and refuses what doesn't add up", () => {
    expect(agentLate({ source: "agent", agentFoundOn: "2026-10-01", agentToldOn: "2026-10-20" })).toMatch(/19 days/);
    expect(agentLate({ source: "agent", agentFoundOn: "2026-10-01", agentToldOn: "2026-10-08" })).toBeNull();
    expect(incidentProblem(input(), "2026-11-20")).toBeNull();
    expect(incidentProblem(input({ discoveredOn: "2026-12-01" }), "2026-11-20")).toMatch(/today or earlier/);
    expect(incidentProblem(input({ dataKinds: [] }), "2026-11-20")).toMatch(/kind of information/);
    expect(incidentProblem(input({ source: "agent" }), "2026-11-20")).toBe("Name the vendor that was breached.");
    expect(stepProblem(incident(), "goodCause", "2026-12-05", "2026-12-06")).toMatch(/within the 30 days/);
    expect(stepProblem(incident(), "closed", "2026-11-20", "2026-11-20")).toBe("Finish the notices first.");
    expect(stepProblem(incident({ done: { individuals: "2026-11-15" } }), "closed", "2026-11-20", "2026-11-20")).toBeNull();
  });

  it("is an owner's permission by default", () => {
    expect(PERMISSIONS.manage_incidents).toBeTruthy();
    expect(can(["ADMIN_OWNER"], "manage_incidents")).toBe(true);
    expect(can(["UNDERWRITER"], "manage_incidents")).toBe(false);
  });
});
