// What a PDF's own record of how it was made says (lib/pdf-signals.ts reads it on the server): an editing program, a
// word processor on a document a bank should have made, changes long after it was made, more saves on top of the first
// version. Pure and safe in a browser, so the demo's sample checks read the same as real ones.
import type { FileCheck } from "./mockData";

export type PdfFacts = {
  software: string[];
  created?: string; modified?: string;
  saves: number;
  encrypted: boolean; signed: boolean;
};

// Online and desktop editors, and the image and design programs people use to fake a page.
const EDITORS: [RegExp, string][] = [
  [/ilovepdf/i, "iLovePDF"], [/smallpdf/i, "Smallpdf"], [/sejda/i, "Sejda"], [/pdfescape/i, "PDFescape"], [/pdf\s?candy/i, "PDF Candy"],
  [/soda\s?pdf/i, "Soda PDF"], [/dochub/i, "DocHub"], [/pdffiller/i, "pdfFiller"], [/pdfsimpli/i, "PDFSimpli"], [/lightpdf/i, "LightPDF"],
  [/pdf2go/i, "PDF2Go"], [/hipdf/i, "HiPDF"], [/pdfgear/i, "PDFgear"], [/xodo/i, "Xodo"], [/formswift/i, "FormSwift"], [/\bcanva\b/i, "Canva"],
  [/pdf-?xchange/i, "PDF-XChange"], [/foxit.*(editor|phantom)/i, "Foxit PDF Editor"], [/nitro/i, "Nitro PDF"], [/pdfelement|wondershare/i, "PDFelement"],
  [/photoshop/i, "Photoshop"], [/illustrator/i, "Illustrator"], [/\bgimp\b/i, "GIMP"], [/inkscape/i, "Inkscape"], [/affinity/i, "Affinity"], [/pixelmator/i, "Pixelmator"],
];
// Where a document is typed up, which is normal for a contract and wrong for a bank's statement.
const WORD_PROCESSORS: [RegExp, string][] = [
  [/microsoft.*word|word for (office|microsoft|mac)|^word$/i, "Microsoft Word"], [/microsoft.*excel|^excel$/i, "Microsoft Excel"],
  [/libreoffice|openoffice/i, "LibreOffice"], [/google docs|docs\.google/i, "Google Docs"], [/^pages$/i, "Apple Pages"],
];
// Printing or re-saving a file: common and innocent, and also how an edited page is flattened back into a PDF.
const RESAVERS: [RegExp, string][] = [
  [/acrobat (pro|standard)|adobe acrobat (\d|dc|pro)/i, "Adobe Acrobat"], [/quartz pdfcontext|mac os x .*quartz|macos .*quartz/i, "a Mac's Preview or Print to PDF"],
  [/microsoft: print to pdf|microsoft print to pdf/i, "Windows Print to PDF"],
];

const named = (list: [RegExp, string][], software: string[]) => [...new Set(software.flatMap((item) => list.filter(([pattern]) => pattern.test(item)).map(([, name]) => name)))];

/** Documents a bank, insurer, appraiser or title company makes, which nobody should be typing up or editing. */
export const issuedDocument = (label: string) => /bank|statement|appraisal|binder|insurance|policy|declarations|commitment|payoff|tax return|1040|1065|1120|\bw-?2\b|pay ?stub|credit report|proof of funds|liquidity|reserves/i.test(label);

const DAY = 86_400_000;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });

/** What the facts say about a file sent as label, uploaded at uploadedAt. Warnings first. */
export function pdfFlags(facts: PdfFacts, label: string, uploadedAt: string): FileCheck["flags"] {
  const issued = issuedDocument(label);
  const flags: FileCheck["flags"] = [];
  const editors = named(EDITORS, facts.software);
  const typed = named(WORD_PROCESSORS, facts.software);
  const resaved = named(RESAVERS, facts.software);
  if (editors.length) flags.push({ level: issued ? "warn" : "note", text: `Saved with ${editors.join(" and ")}, a program for editing PDFs or images${issued ? ", not the system that issues this kind of document" : ""}.` });
  if (issued && typed.length) flags.push({ level: "warn", text: `Made in ${typed.join(" and ")}. A bank's, insurer's or appraiser's own document isn't typed up in a word processor.` });
  if (issued && resaved.length) flags.push({ level: "note", text: `Re-saved with ${resaved.join(" and ")}. That happens when someone prints or combines files, and also after editing one.` });
  const later = Date.parse(uploadedAt) + DAY;
  if (facts.created && Date.parse(facts.created) > later) flags.push({ level: "warn", text: `It says it was made on ${shortDate(facts.created)}, after it was uploaded.` });
  else if (facts.modified && Date.parse(facts.modified) > later) flags.push({ level: "warn", text: `It says it was last changed on ${shortDate(facts.modified)}, after it was uploaded.` });
  if (facts.created && facts.modified) {
    const gap = (Date.parse(facts.modified) - Date.parse(facts.created)) / DAY;
    if (gap >= 1) flags.push({ level: issued && (editors.length > 0 || facts.saves > 0) ? "warn" : "note", text: `Changed ${Math.round(gap)} day${Math.round(gap) === 1 ? "" : "s"} after it was made (made ${shortDate(facts.created)}, last changed ${shortDate(facts.modified)}).` });
    else if (gap < -1) flags.push({ level: "note", text: "Its last-changed date is before the day it says it was made." });
  }
  if (facts.saves > 0 && !facts.signed) flags.push({ level: "note", text: `Saved ${facts.saves} more time${facts.saves === 1 ? "" : "s"} on top of the first version.` });
  if (issued && !facts.encrypted && !facts.software.length && !facts.created) flags.push({ level: "note", text: "It has no record of what made it or when. That record may have been removed." });
  if (facts.encrypted) flags.push({ level: "note", text: "It's encrypted, so the record of what made it couldn't be read." });
  return [...flags.filter((flag) => flag.level === "warn"), ...flags.filter((flag) => flag.level === "note")];
}

