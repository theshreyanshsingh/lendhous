// A title search before each draw (docs/competitor-gaps-2026-11-09.md, rank 9). A lien or judgment recorded against the
// property after closing can come ahead of money lent later, so before a construction draw goes out the title company
// searches the official records from the day the mortgage was recorded and says whether anything new is there. The team
// asks through the title company's secure link, the title company answers there (or the team records an answer it got
// another way), and the draw is held until a clean answer is in. An owner sets which draws need it in Settings, and can
// still release a draw past the hold with a reason, as with the lien-law holds. Pure, given that setting.
import type { Deal, DrawRequest, TitleUpdate } from "./mockData";
import { addDays } from "./servicing";

export type TitleCheckRule = { on: boolean; minDraw: number };
// Off until Settings switches it on (on by default there); tests and pages set it the way they set draw fees.
let rule: TitleCheckRule = { on: false, minDraw: 0 };
export const titleCheckRule = () => rule;
export const setTitleCheckRule = (next: TitleCheckRule) => { rule = { on: next.on !== false, minDraw: Math.max(0, Number(next.minDraw) || 0) }; };

/** PLACEHOLDER: a search that ran through a day this long before the release is asked for again. */
export const TITLE_UPDATE_DAYS = 30;

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** What the draw is for: what was approved, or what was asked for until then. */
export const drawAmount = (draw: Pick<DrawRequest, "approved" | "lines">) => draw.approved ?? draw.lines.reduce((sum, line) => sum + line.requested, 0);

/** Whether this draw needs a title search before it goes out, under the owner's setting. */
export const titleUpdateNeeded = (draw: Pick<DrawRequest, "approved" | "lines">) => rule.on && drawAmount(draw) >= rule.minDraw;

/** The answer that counts: the newest. */
export const latestTitleUpdate = (draw: Pick<DrawRequest, "titleCheck">): TitleUpdate | undefined => draw.titleCheck?.updates.at(-1);

/** The day the search runs from: when the mortgage was recorded, if that's on file. */
export const searchFrom = (deal: Pick<Deal, "closing" | "lienFile">) => deal.closing?.recording?.on ?? deal.lienFile?.mortgageRecordedOn;

/** What holds the draw for its title search, or null. */
export function titleUpdateHold(draw: DrawRequest, today: string) {
  if (!titleUpdateNeeded(draw)) return null;
  const latest = latestTitleUpdate(draw);
  if (!latest) return draw.titleCheck?.asked ? `The title company's search since recording, asked for on ${longDay(draw.titleCheck.asked.at.slice(0, 10))}, isn't back yet.` : "No title search since the mortgage was recorded. Ask the title company for one on this draw.";
  if (!latest.clean) return `The title search through ${longDay(latest.through)} found something recorded since closing: ${latest.found}. Clear it with the title company or the attorney first.`;
  if (addDays(latest.through, TITLE_UPDATE_DAYS) < today) return `The title search only runs through ${longDay(latest.through)}. Ask for a newer one.`;
  return null;
}

/** Why this answer can't be recorded, or null. */
export function titleUpdateProblem(deal: Pick<Deal, "closing" | "lienFile"> | undefined, draw: DrawRequest | undefined, input: { clean: boolean; through: string; found: string }, today: string) {
  if (!deal || !draw) return "That draw no longer exists.";
  if (draw.status === "funded" || draw.status === "rejected") return "That draw has already been decided.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.through) || input.through > today) return "Enter the day the records were searched through, today or earlier.";
  const from = searchFrom(deal);
  if (from && input.through < from) return "The search has to run past the day the mortgage was recorded.";
  if (!input.clean && !input.found.trim()) return "Say what was recorded: the kind of document, who it's for and the book and page.";
  return null;
}
