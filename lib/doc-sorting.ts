// Filing a batch of documents at once (Santosh's ask, 2026-11-10): each file goes to the checklist item its name points to,
// so a borrower or broker can drop a folder of papers and send them in one go, checking where each lands first. The
// guess is from the file's name only (nothing is read from inside it, which waits on the document reader, K), and a person
// always sees it and can change it. Pure.
import type { Deal, Doc } from "./mockData";

/**
 * Words in a file's name and the checklist item each points to, most specific first: a settlement statement isn't a bank
 * statement, and a contractor's license isn't a driver's license.
 */
const RULES: { doc: string; words: RegExp }[] = [
  { doc: "good-standing", words: /good[\s_-]*standing|certificate[\s_-]*of[\s_-]*status|sunbiz/ },
  { doc: "ein", words: /\bein\b|cp[\s_-]*575|147[\s_-]*c|tax[\s_-]*id/ },
  { doc: "entity", words: /operating[\s_-]*agreement|articles|\boa\b|llc|organization|formation|annual[\s_-]*report/ },
  { doc: "contractor", words: /contractor|\bbid\b|\bgc\b|estimate|proposal/ },
  { doc: "foreign", words: /visa|foreign/ },
  { doc: "id", words: /driver|passport|\bid\b|\bdl\b|identification|license/ },
  { doc: "payoff", words: /payoff/ },
  { doc: "hud-original", words: /hud|settlement|closing[\s_-]*statement|\balta\b|\bcd\b/ },
  { doc: "contract", words: /contract|purchase|\bpsa\b|addendum|as[\s_-]*is/ },
  { doc: "sow", words: /scope|\bsow\b|budget|rehab|renovation/ },
  { doc: "plans", words: /plans?\b|permit|drawing|blueprint|architect/ },
  { doc: "str-income", words: /airbnb|vrbo|payout|airdna|short[\s_-]*term/ },
  { doc: "lease", words: /lease|rent[\s_-]*roll|rental[\s_-]*agreement/ },
  { doc: "bank", words: /bank|statement|checking|savings|chase|wells|truist|bofa|citi|brokerage|account/ },
  { doc: "insurance", words: /insurance|binder|policy|declaration|dec[\s_-]*page|hazard|wind|flood/ },
  { doc: "explanation", words: /explanation|\bloe\b|letter[\s_-]*of/ },
];

/** A settlement statement is the past deals' proof once the loan asks for it, and the original purchase's otherwise. */
const ALSO: Record<string, string> = { "hud-original": "track" };

const open = (doc: Doc) => doc.status === "requested" || doc.status === "rejected";

/**
 * The checklist item a file's name points to on this loan, or null. Items still to send come first; one already in is
 * suggested only when nothing open matches, so a newer copy can replace it.
 */
export function suggestDoc(fileName: string, docs: Doc[]): string | null {
  const name = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[_.]+/g, " ");
  const candidates = RULES.filter((rule) => rule.words.test(name)).flatMap((rule) => [rule.doc, ...(ALSO[rule.doc] ? [ALSO[rule.doc]] : [])]);
  const onLoan = candidates.map((id) => docs.find((doc) => doc.id === id)).filter((doc): doc is Doc => Boolean(doc));
  return (onLoan.find(open) ?? onLoan[0])?.id ?? null;
}

export type Filing = { fileName: string; docId: string | null };
/**
 * Where each of a batch goes: by name, and never two files to one item, since each item holds one file and a second bank
 * statement would replace the first. Anything left over is for the person to place or name as its own document.
 */
export function fileBatch(names: string[], docs: Doc[]): Filing[] {
  const taken = new Set<string>();
  return names.map((fileName) => {
    const docId = suggestDoc(fileName, docs.filter((doc) => !taken.has(doc.id)));
    if (docId) taken.add(docId);
    return { fileName, docId };
  });
}

/** Every document with a file on a person's loans, newest loan first, for their own documents page. */
export function filedDocuments(deals: Pick<Deal, "id" | "loanNumber" | "address" | "city" | "status" | "closingDate" | "docs">[]) {
  return [...deals].sort((a, b) => b.closingDate.localeCompare(a.closingDate)).flatMap((deal) => deal.docs.filter((doc) => doc.documentId || doc.fileName).map((doc) => ({ deal, doc })));
}

/** Why a file already on one of the person's loans can't be used for a checklist item on another, or null. */
export function reuseProblem(target: Deal | undefined, targetDoc: Doc | undefined, source: Deal | undefined, sourceDoc: Doc | undefined) {
  if (!target || !targetDoc || !source || !(sourceDoc?.documentId || sourceDoc?.fileName)) return "That document isn't there any more.";
  if (target.id === source.id) return "Choose a different loan's document.";
  if (!open(targetDoc)) return "That item isn't waiting for a document.";
  if (["paid_off", "declined", "withdrawn", "reo"].includes(target.status)) return "This loan isn't taking documents any more.";
  if (sourceDoc.status === "rejected") return "That one was sent back: send a new copy instead.";
  return null;
}
