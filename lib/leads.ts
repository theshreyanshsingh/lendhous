// Project briefs from the public site's /start form. The form and the server action share this file, so it holds no
// database code. A brief is not an application: no credit is pulled and nothing is decided on it.

export const STRATEGIES = ["Fix & flip", "DSCR rental", "Bridge financing", "Ground-up construction", "Rental portfolio", "Not sure yet"];
export const EXPERIENCE = ["First investment", "1–3 completed projects", "4–10 completed projects", "11+ completed projects"];

// Whole dollars. Stored as cents in a 32-bit Int, which tops out just above $21.4M.
export const MAX_LEAD_DOLLARS = 21_000_000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type LeadDetails = {
  name: string;
  email: string;
  phone: string;
  strategy: string;
  experience: string;
  city: string;
  state: string;
  propertyValueCents: number;
  renovationCents: number;
  requestedLoanCents: number;
  targetClosing: string;
  notes: string;
};

export type ParsedLead = { ok: true; lead: LeadDetails } | { ok: false; error: string };

const oneLine = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function cents(value: unknown, min: number) {
  const dollars = Number(String(value ?? "").trim());
  if (String(value ?? "").trim() === "" || !Number.isFinite(dollars) || dollars < min || dollars > MAX_LEAD_DOLLARS) return null;
  return Math.round(dollars * 100);
}

export function parseLead(fields: Record<string, unknown>): ParsedLead {
  const name = oneLine(fields.name, 120);
  const email = oneLine(fields.email, 200).toLowerCase();
  const phone = oneLine(fields.phone, 40);
  const city = oneLine(fields.city, 100);
  const state = oneLine(fields.state, 50);
  const notes = String(fields.notes ?? "").trim().slice(0, 1500);
  const targetClosing = oneLine(fields.targetClosing, 10);
  if (!name) return { ok: false, error: "Enter your name." };
  if (!EMAIL.test(email)) return { ok: false, error: "Enter an email address we can reach you at." };
  if (!city || !state) return { ok: false, error: "Enter the property's city and state." };
  if (!notes) return { ok: false, error: "Tell us about your exit strategy and project." };
  if (targetClosing && !DATE.test(targetClosing)) return { ok: false, error: "Enter a valid target closing date." };
  const limit = `$${MAX_LEAD_DOLLARS.toLocaleString("en-US")}`;
  const propertyValueCents = cents(fields.propertyValue, 1);
  if (propertyValueCents === null) return { ok: false, error: `Enter a purchase price or value between $1 and ${limit}.` };
  const renovationCents = cents(fields.renovation, 0);
  if (renovationCents === null) return { ok: false, error: `Enter a renovation budget between $0 and ${limit}.` };
  const requestedLoanCents = cents(fields.requestedLoan, 1);
  if (requestedLoanCents === null) return { ok: false, error: `Enter a requested loan between $1 and ${limit}.` };
  return {
    ok: true,
    lead: {
      name,
      email,
      phone,
      strategy: STRATEGIES.includes(String(fields.strategy)) ? String(fields.strategy) : "Not sure yet",
      experience: EXPERIENCE.includes(String(fields.experience)) ? String(fields.experience) : "",
      city,
      state,
      propertyValueCents,
      renovationCents,
      requestedLoanCents,
      targetClosing,
      notes,
    },
  };
}

const money = (amountCents: number) => `$${Math.round(amountCents / 100).toLocaleString("en-US")}`;

/** The brief as plain text: the team's alert email, and the copy a visitor can download. */
export function leadSummary(lead: LeadDetails) {
  return [
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phone || "Not given"}`,
    `Program: ${lead.strategy}`,
    `Experience: ${lead.experience || "Not given"}`,
    `Property: ${lead.city}, ${lead.state}`,
    `Purchase price or value: ${money(lead.propertyValueCents)}`,
    `Renovation budget: ${money(lead.renovationCents)}`,
    `Requested loan: ${money(lead.requestedLoanCents)}`,
    `Target closing: ${lead.targetClosing || "Not given"}`,
    "",
    "Exit strategy and project notes:",
    lead.notes,
  ].join("\n");
}
