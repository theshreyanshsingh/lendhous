// The borrower's side of a loan's documents and contacts: what's still to do and what's in, the words each document's
// state is shown in, documents the borrower adds unasked, and their title/escrow and insurance agents.
import type { Deal, Doc, DocStatus, LoanStatus } from "./mockData";

export const TO_DO: DocStatus[] = ["requested", "rejected"];

export type DocBadge = { label: string; tone: "rose" | "amber" | "slate" | "blue" | "green" };
/** How a document's state reads to the borrower. */
export function docBadge(doc: Doc): DocBadge {
  if (doc.status === "rejected") return { label: "Action needed", tone: "rose" };
  if (doc.status === "requested") return doc.optional ? { label: "If it applies", tone: "slate" } : { label: "Needed", tone: "amber" };
  if (doc.status === "uploaded") return { label: "Uploaded", tone: "blue" };
  if (doc.status === "in_review") return { label: "In review", tone: "blue" };
  if (doc.status === "accepted") return { label: "Accepted ✓", tone: "green" };
  return { label: "Not needed", tone: "slate" };
}

/** What the upload button says: a sent-back document asks for a corrected one. */
export const uploadLabel = (doc: Doc) => (doc.status === "rejected" ? "Upload a corrected version" : doc.status === "uploaded" ? "Replace" : "Upload");

/** The documents still to send, sent-back ones first, and those in, newest decisions last. */
export function splitDocs(docs: Doc[]) {
  const toDo = docs.filter((doc) => TO_DO.includes(doc.status)).sort((a, b) => Number(b.status === "rejected") - Number(a.status === "rejected") || Number(Boolean(a.optional)) - Number(Boolean(b.optional)));
  const submitted = docs.filter((doc) => !TO_DO.includes(doc.status));
  return { toDo, submitted };
}

/** A document the borrower adds unasked: an id their browser makes, so the file can follow it straight away. */
export const OWN_DOC_ID = /^own-[a-z0-9]{6,24}$/;
export function ownDocProblem(name: string) {
  if (!name.trim()) return "Say what the document is.";
  if (name.trim().length > 120) return "Keep the name under 120 characters.";
  return null;
}

export type AgentRole = "title" | "insurance";
export const AGENT_LABEL: Record<AgentRole, string> = { title: "Title / escrow agent", insurance: "Insurance agent" };
export type AgentInput = { name: string; company: string; email: string; phone: string };
export type AgentContact = AgentInput & { by: string; at: string };

/** Why an agent's details can't be saved, or null: someone to talk to, and a way to reach them. */
export function agentProblem(contact: AgentInput) {
  if (!contact.name.trim() && !contact.company.trim()) return "Add the agent's name or company.";
  if (!contact.email.trim() && contact.phone.replace(/\D/g, "").length < 10) return "Add an email or a phone number for them.";
  if (contact.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) return "That email doesn't look right.";
  if ([contact.name, contact.company, contact.email, contact.phone].some((value) => value.length > 160)) return "Keep each detail under 160 characters.";
  return null;
}

/** From the accepted term sheet to closing, the team needs both agents to coordinate the title work and the binder. */
const AGENTS_NEEDED: LoanStatus[] = ["term_sheet_accepted", "conditions", "clear_to_close", "closing"];
export const agentsMissing = (deal: Deal) => (["title", "insurance"] as AgentRole[]).filter((role) => !deal.agents?.[role]);
export const shouldAskAgents = (deal: Deal) => AGENTS_NEEDED.includes(deal.status) && agentsMissing(deal).length > 0;
