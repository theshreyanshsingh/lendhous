// Signs that a PDF was changed after it was made (docs/competitor-gaps-2026-11-09.md, rank 10). No AI, and nothing leaves
// the server: only the file's own record of the software that made and saved it, its dates, and how many times it was
// saved again on top of the first version. A bank makes its statements with its own systems; a statement last saved by
// an online PDF editor, a word processor or a photo editor, or changed long after it was made, deserves a closer look.
// These are signals, not proof. Combining two statements or printing one to PDF trips some of them innocently, so the
// team asks the borrower before deciding anything. Server only (it reads compressed parts of the file with zlib).
import { constants, inflateSync } from "node:zlib";
import type { FileCheck } from "./mockData";
import { pdfFlags, type PdfFacts } from "./pdf-flags";

export { issuedDocument, pdfFlags, type PdfFacts } from "./pdf-flags";

// A literal string in parentheses: balanced parentheses don't need escaping, backslashes do.
function literalAt(text: string, start: number) {
  let depth = 0;
  let out = "";
  for (let i = start; i < text.length && i < start + 4000; i++) {
    const c = text[i];
    if (c === "\\") {
      const next = text[i + 1];
      const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      if (next in simple) { out += simple[next]; i++; continue; }
      const octal = /^[0-7]{1,3}/.exec(text.slice(i + 1, i + 4));
      if (octal) { out += String.fromCharCode(parseInt(octal[0], 8)); i += octal[0].length; continue; }
      if (next === "\r" || next === "\n") { i += next === "\r" && text[i + 2] === "\n" ? 2 : 1; continue; }
      continue;
    }
    if (c === "(") { if (depth++ > 0) out += c; continue; }
    if (c === ")") { if (--depth === 0) return out; out += c; continue; }
    out += c;
  }
  return out;
}

// Text strings are PDFDocEncoding (close to Latin-1) or UTF-16 with a byte-order mark.
function decodeBytes(raw: string) {
  if (raw.startsWith("\xfe\xff")) { let out = ""; for (let i = 2; i + 1 < raw.length; i += 2) out += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1)); return out; }
  if (raw.startsWith("\xff\xfe")) { let out = ""; for (let i = 2; i + 1 < raw.length; i += 2) out += String.fromCharCode(raw.charCodeAt(i) | (raw.charCodeAt(i + 1) << 8)); return out; }
  return raw;
}

/** The value after a key like /Producer: a literal string, a hex string, or nothing readable. */
function valueAfter(text: string, at: number) {
  let i = at;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === "(") return decodeBytes(literalAt(text, i)).replace(/\0/g, "").trim();
  if (text[i] === "<" && text[i + 1] !== "<") {
    const end = text.indexOf(">", i);
    if (end < 0) return "";
    const hex = text.slice(i + 1, end).replace(/\s/g, "");
    let raw = "";
    for (let j = 0; j + 1 < hex.length; j += 2) raw += String.fromCharCode(parseInt(hex.slice(j, j + 2), 16));
    return decodeBytes(raw).replace(/\0/g, "").trim();
  }
  return "";
}

/** A PDF date (D:YYYYMMDDHHmmSS+HH'mm') as an ISO time, or undefined. */
export function pdfDate(value: string) {
  const match = /(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*([Zz+-])?\s*(\d{2})?'?(\d{2})?/.exec(value.replace(/^D:/, ""));
  if (!match) return undefined;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", sign, oh = "00", om = "00"] = match;
  const offset = sign === "+" || sign === "-" ? `${sign}${oh}:${om}` : "Z";
  const time = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

// XMP (the XML metadata many programs add) as plain text: the tool that made it, the producer, dates, and the history of saves.
function xmpFacts(xml: string) {
  const tags = (name: string) => [...xml.matchAll(new RegExp(`<${name}>([^<]{1,300})</${name}>|${name}="([^"]{1,300})"`, "g"))].map((match) => (match[1] ?? match[2]).trim());
  return { software: [...tags("xmp:CreatorTool"), ...tags("pdf:Producer"), ...tags("stEvt:softwareAgent")], created: tags("xmp:CreateDate")[0], modified: tags("xmp:ModifyDate")[0] };
}

const MAX_STREAMS = 300;
const MAX_INFLATED = 20 * 1024 * 1024;

/**
 * Compressed parts of the file that can hold its metadata: object streams (where newer PDFs keep their dictionaries) and
 * metadata streams. Bounded, so a hostile file can't make the server do much work.
 */
function inflatedParts(text: string, bytes: Buffer) {
  const parts: string[] = [];
  let total = 0;
  let seen = 0;
  for (let at = text.indexOf("stream"); at >= 0 && seen < MAX_STREAMS && total < MAX_INFLATED; at = text.indexOf("stream", at + 6)) {
    if (text.slice(at - 3, at) === "end") continue;
    const before = text.slice(Math.max(0, at - 2048), at);
    const objAt = before.lastIndexOf(" obj");
    if (objAt < 0 || !/>>\s*$/.test(before)) continue;
    const dict = before.slice(objAt);
    if (!/\/FlateDecode/.test(dict) || !/\/Type\s*\/(ObjStm|Metadata)/.test(dict)) continue;
    seen++;
    let start = at + 6;
    if (text[start] === "\r") start++;
    if (text[start] === "\n") start++;
    const end = text.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      const out = inflateSync(bytes.subarray(start, end), { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: 5 * 1024 * 1024 });
      total += out.length;
      parts.push(out.toString("latin1"));
    } catch {
      // Not readable: leave it.
    }
  }
  return parts;
}

/** What the file says about itself. Never throws: a file it can't read just says less. */
export function readPdfFacts(bytes: Buffer): PdfFacts {
  const text = bytes.toString("latin1");
  const encrypted = /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(text);
  const signed = /\/ByteRange\s*\[/.test(text) && /\/Type\s*\/Sig\b/.test(text);
  const eofs = (text.match(/%%EOF/g) ?? []).length;
  // A file arranged for fast web viewing ("linearized") has two end markers from the start.
  const linearized = /\/Linearized\s/.test(text.slice(0, 2048));
  const saves = Math.max(0, eofs - (linearized ? 2 : 1));
  const software: string[] = [];
  const created: string[] = [];
  const modified: string[] = [];
  const sources = [text, ...inflatedParts(text, bytes)];
  for (const source of sources) {
    for (const match of source.matchAll(/\/(Producer|Creator|CreationDate|ModDate)(?=[\s(<])/g)) {
      const value = encrypted ? "" : valueAfter(source, match.index! + match[0].length);
      if (!value) continue;
      if (match[1] === "Producer" || match[1] === "Creator") software.push(value);
      else (match[1] === "CreationDate" ? created : modified).push(value);
    }
    const xmpStart = source.indexOf("<x:xmpmeta");
    if (xmpStart >= 0) {
      const xmpEnd = source.indexOf("</x:xmpmeta>", xmpStart);
      const xmp = xmpFacts(source.slice(xmpStart, xmpEnd > 0 ? xmpEnd + 12 : xmpStart + 200_000));
      software.push(...xmp.software);
      if (xmp.created) created.push(xmp.created);
      if (xmp.modified) modified.push(xmp.modified);
    }
  }
  const dates = (list: string[]) => list.map((item) => (/^\d{4}-\d{2}-\d{2}/.test(item) ? (Number.isFinite(Date.parse(item)) ? new Date(item).toISOString() : undefined) : pdfDate(item))).filter((item): item is string => Boolean(item)).sort();
  const made = dates(created);
  const changed = dates(modified);
  return { software: [...new Set(software.map((item) => item.slice(0, 120)))].slice(0, 12), created: made[0], modified: changed.at(-1), saves, encrypted, signed };
}

/** The check stored on the loan for one PDF. */
export function checkPdf(bytes: Buffer, input: { documentId: string; fileName: string; label: string; at: string }): FileCheck {
  const facts = readPdfFacts(bytes);
  return { ...input, software: facts.software, created: facts.created, modified: facts.modified, saves: facts.saves, encrypted: facts.encrypted || undefined, signed: facts.signed || undefined, flags: pdfFlags(facts, `${input.label} ${input.fileName}`, input.at) };
}
