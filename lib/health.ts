// Whether the app can run unattended: the nightly jobs that money and compliance depend on have run recently. Pure,
// so the health check, the owners' banner and the tests agree.
export const WATCHED_JOBS = ["servicing", "sanctions"] as const;
export const STALE_HOURS = 48;
export const JOB_LABEL: Record<string, string> = { servicing: "servicing check (late payments and maturity)", sanctions: "sanctions list download and screening" };

/** The watched jobs that haven't finished a run in STALE_HOURS, or ever. */
export const staleJobs = (lastRuns: Record<string, Date | null | undefined>, now: Date) =>
  WATCHED_JOBS.filter((job) => { const at = lastRuns[job]; return !at || now.getTime() - at.getTime() > STALE_HOURS * 3_600_000; });
