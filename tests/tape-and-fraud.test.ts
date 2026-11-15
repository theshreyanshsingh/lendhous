import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { authorize, scopeBook, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { titleView } from "@/lib/closing";
import { evaluate } from "@/lib/engine";
import { drawHolds, unreleasedHolds } from "@/lib/lien-law";
import { nextStage } from "@/lib/loan-stages";
import { toCsv } from "@/lib/csv";
import { columnsFor, payString, TAPE_COLUMNS, tapeJson, tapeRow } from "@/lib/loan-tape";
import { BORROWER_ID, DEMO_BUYER_ID, type Deal } from "@/lib/mockData";
import { checkPdf, pdfDate, pdfFlags, readPdfFacts } from "@/lib/pdf-signals";
import { can, type Permission } from "@/lib/permissions";
import { sellerBlockers, sellerCheckNeeded, sellerFlags } from "@/lib/seller-checks";
import { rulesFrom } from "@/lib/settings-rules";
import { setTitleCheckRule, titleUpdateHold } from "@/lib/title-updates";

const person = (id: string, roles: Viewer["roleCodes"]): Viewer => ({ id, name: `${id} name`, roleCodes: roles });
const owner = person("olivia", ["ADMIN_OWNER"]);
const processor = person("pat", ["PROCESSOR"]);
const titleCo: Viewer = { id: "title-link:d5", name: "Terry (title company)", roleCodes: [] };
const check = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), trusted);
const run = (b: Book, viewer: Viewer, action: BookAction, trusted = false) => {
  const result = check(b, viewer, action, trusted);
  if ("error" in result) throw new Error(result.error);
  return reducer(b, result.action);
};
const deal = (b: Book, id: string) => b.deals.find((d) => d.id === id)!;
const DAY = "2026-10-31";

afterEach(() => setTitleCheckRule({ on: false, minDraw: 0 }));

describe("the downloadable loan tape (rank 6)", () => {
  const b = demoBook();
  it("has one fixed column list, documented in docs/loan-tape.md", () => {
    const doc = readFileSync("docs/loan-tape.md", "utf8");
    for (const column of TAPE_COLUMNS) expect(doc).toContain(`\`${column.key}\``);
    expect(new Set(TAPE_COLUMNS.map((column) => column.key)).size).toBe(TAPE_COLUMNS.length);
    const full = tapeRow(deal(b, "d12"), "full", DAY);
    expect(Object.keys(full)).toEqual(TAPE_COLUMNS.map((column) => column.key));
  });
  it("the blind tape names no borrower, guarantor, street or city", () => {
    const loan = deal(b, "d12");
    const blind = tapeRow(loan, "blind", DAY);
    expect(Object.keys(blind)).toEqual(columnsFor("blind").map((column) => column.key));
    const text = JSON.stringify(blind);
    for (const secret of [loan.borrowerName, loan.entityName, loan.address, loan.city, loan.zip, ...(loan.sponsor?.guarantors ?? []).map((item) => item.name)]) expect(text).not.toContain(secret);
    expect(blind).toMatchObject({ tape_id: "N-1012", zip3: "334", county: "Palm Beach", product: "ground_up", lien_position: "1st", holdback_left: 420_000 });
    expect(tapeRow(loan, "full", DAY)).toMatchObject({ borrower_name: loan.borrowerName, street_address: loan.address, zip: loan.zip });
  });
  it("gives a 12-month pay history from the ledger as it stood each month-end, oldest first", () => {
    expect(payString(deal(b, "d12"), DAY)).toBe("NNNNNNCCCCCC");
    expect(payString(deal(b, "d13"), DAY)).toBe("NNNNNCCCCCC2");
    // Nothing paid since closing in mid-January: 27, 58 and 88 days late, then 90 or more.
    const unpaid: Deal = { ...deal(b, "d12"), closingDate: "2026-01-15", payments: [], bills: [], boardedThrough: undefined, servicedThrough: undefined, nextPaymentDue: undefined, paymentsLate: 0, disbursedDraws: 0 };
    expect(payString(unpaid, DAY)).toBe("NNNC12333333");
    expect(payString({ ...deal(b, "d12"), paidOff: { amount: 1, receivedOn: "2026-09-10", method: "wire", reference: "x", by: "x", at: "x", owed: 1 } }, DAY).slice(-2)).toBe("PP");
  });
  it("prices a listed loan at its asking price, and the JSON says what each column means", () => {
    const sale = b.sales.find((item) => item.dealId === "d12")!;
    const row = tapeRow(deal(b, "d12"), "blind", DAY, sale);
    expect(row.ask_pct).toBe(sale.askPct);
    expect(Number(row.yield_at_ask)).toBeGreaterThan(0);
    const file = JSON.parse(tapeJson([row], "blind", DAY));
    expect(file).toMatchObject({ version: "blind", asOf: DAY, loans: [row] });
    expect(file.columns.find((column: { key: string }) => column.key === "pay_string_12m").about).toMatch(/oldest first/);
    // Nothing on the tape starts like a spreadsheet formula, so the CSV carries it as is.
    expect(toCsv([row]).split("\r\n")[1]).not.toContain("'");
  });
  it("a buyer's copy carries each loan's row, worked out by the server from the whole loan", () => {
    const view = scopeBook(b, { id: DEMO_BUYER_ID, name: "Bella", roleCodes: ["LOAN_BUYER"] });
    const listed = view.sales.find((sale) => sale.dealId === "d12")!;
    expect(listed.tape).toMatchObject({ tape_id: "N-1012", insurance_expires: expect.stringMatching(/^\d{4}-/) });
    expect(listed.tape).not.toHaveProperty("borrower_name");
    // The buyer's own copy of the loan leaves the insurance out, which is why the server works the row out.
    expect(view.deals.find((item) => item.id === "d12")!.insurance).toBeUndefined();
    const owned = view.sales.find((sale) => sale.soldTo === DEMO_BUYER_ID)!;
    expect(owned.tape).toMatchObject({ borrower_name: deal(b, owned.dealId).borrowerName });
    // Staff get the whole book and work rows out themselves.
    expect(scopeBook(b, owner).sales.every((sale) => !sale.tape)).toBe(true);
  });
});

const pdf = (...parts: (string | Buffer)[]) => Buffer.concat(parts.map((part) => (typeof part === "string" ? Buffer.from(part, "latin1") : part)));

describe("PDF tamper signals (rank 10)", () => {
  it("reads the software and dates from the file's information dictionary", () => {
    const file = pdf("%PDF-1.7\n1 0 obj << /Producer (iLovePDF) /Creator (Sample Bank \\(eStatements\\) 9) /CreationDate (D:20260930090000-04'00') /ModDate (D:20261028211400Z) >> endobj\ntrailer << /Info 1 0 R >>\n%%EOF\n");
    const facts = readPdfFacts(file);
    expect(facts.software).toEqual(["iLovePDF", "Sample Bank (eStatements) 9"]);
    expect(facts).toMatchObject({ created: "2026-09-30T13:00:00.000Z", modified: "2026-10-28T21:14:00.000Z", saves: 0, encrypted: false, signed: false });
    expect(pdfDate("D:2026")).toBe("2026-01-01T00:00:00.000Z");
  });
  it("reads UTF-16 text, compressed object streams and XMP, and counts saves on top of the first version", () => {
    const hex = Buffer.from("﻿Microsoft® Word", "utf16le").swap16().toString("hex");
    const inner = deflateSync(Buffer.from(`3 0 << /Producer <${hex}> /CreationDate (D:20260901120000Z) >>`, "latin1"));
    const file = pdf("%PDF-1.7\n2 0 obj << /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ", String(inner.length), " >>\nstream\n", inner, "\nendstream\nendobj\n%%EOF\n",
      "4 0 obj << /Type /Metadata /Subtype /XML >>\nstream\n<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:Description xmp:CreatorTool=\"Canva\" xmp:ModifyDate=\"2026-10-20T10:00:00Z\"/></x:xmpmeta>\nendstream\nendobj\n%%EOF\n");
    const facts = readPdfFacts(file);
    expect(facts.software).toEqual(expect.arrayContaining(["Microsoft® Word", "Canva"]));
    expect(facts).toMatchObject({ created: "2026-09-01T12:00:00.000Z", modified: "2026-10-20T10:00:00.000Z", saves: 1 });
  });
  it("doesn't count a linearized file's two end markers as a save, and says when it can't read an encrypted one", () => {
    expect(readPdfFacts(pdf("%PDF-1.5\n1 0 obj << /Linearized 1 /L 100 >> endobj\n%%EOF\n2 0 obj << /Producer (iText 7) >> endobj\n%%EOF\n")).saves).toBe(0);
    const locked = readPdfFacts(pdf("%PDF-1.7\n1 0 obj << /Producer (\x8a\x9f\x11) >> endobj\ntrailer << /Encrypt 5 0 R /Info 1 0 R >>\n%%EOF\n"));
    expect(locked).toMatchObject({ encrypted: true, software: [] });
    expect(pdfFlags(locked, "Bank statements", "2026-10-29T14:00:00Z").map((flag) => flag.text)).toEqual([expect.stringMatching(/encrypted/)]);
  });
  it("warns on a bank statement edited or typed up, and only notes the same on a contract", () => {
    const edited = { software: ["Sample Bank eStatements", "Sejda PDF Desktop"], created: "2026-09-30T13:00:00Z", modified: "2026-10-28T21:00:00Z", saves: 1, encrypted: false, signed: false };
    const statement = pdfFlags(edited, "Bank statements", "2026-10-29T14:00:00Z");
    expect(statement.filter((flag) => flag.level === "warn").map((flag) => flag.text)).toEqual([expect.stringMatching(/Saved with Sejda/), expect.stringMatching(/Changed 28 days after it was made/)]);
    expect(statement.at(-1)).toMatchObject({ level: "note", text: expect.stringMatching(/Saved 1 more time/) });
    const typed = { software: ["Microsoft® Word for Microsoft 365"], saves: 0, encrypted: false, signed: false };
    expect(pdfFlags(typed, "Bank statements", "2026-10-29T14:00:00Z")).toEqual([{ level: "warn", text: expect.stringMatching(/Made in Microsoft Word/) }]);
    expect(pdfFlags(typed, "Purchase contract", "2026-10-29T14:00:00Z")).toEqual([]);
    expect(pdfFlags({ ...edited, created: undefined, modified: undefined, saves: 0 }, "Purchase contract", "2026-10-29T14:00:00Z")).toEqual([{ level: "note", text: expect.stringMatching(/Saved with Sejda/) }]);
    // Dated after it arrived.
    expect(pdfFlags({ software: [], created: "2026-12-01T00:00:00Z", saves: 0, encrypted: false, signed: false }, "Appraisal", "2026-10-29T14:00:00Z")[0]).toMatchObject({ level: "warn", text: expect.stringMatching(/after it was uploaded/) });
  });
  it("a file name counts toward what kind of document it is, and a garbage file just says less", () => {
    const check = checkPdf(pdf("%PDF-1.4\n1 0 obj << /Producer (Microsoft Word) >> endobj\n%%EOF\n"), { documentId: "d", fileName: "Chase statement Sept.pdf", label: "Loan file", at: "2026-10-29T14:00:00Z" });
    expect(check.flags[0]).toMatchObject({ level: "warn" });
    expect(readPdfFacts(Buffer.from("%PDF-1.4 garbage stream\x00\xff endstream"))).toMatchObject({ software: [], saves: 0 });
  });
  it("only the server records a check, and only the team sees them", () => {
    const b = demoBook();
    const action: BookAction = { t: "recordFileCheck", dealId: "d16", check: { documentId: "x", fileName: "x.pdf", label: "Bank statements", at: "2026-10-29T14:00:00Z", software: [], saves: 0, flags: [] } };
    expect(check(b, owner, action)).toEqual({ error: "Your account can't do that." });
    const after = run(b, owner, action, true);
    expect(deal(after, "d16").fileChecks?.map((item) => item.documentId)).toEqual(["demo-file-d16-bank", "x"]);
    // The demo's edited statement reads like a real check.
    expect(deal(b, "d16").fileChecks![0].flags[0]).toMatchObject({ level: "warn", text: expect.stringMatching(/iLovePDF/) });
    const borrowerId = deal(b, "d16").borrowerId;
    expect(scopeBook(after, { id: borrowerId, name: "b", roleCodes: ["BORROWER"] }).deals.find((item) => item.id === "d16")?.fileChecks).toBeUndefined();
  });
});

describe("vacant-land and absent-seller checks (rank 8)", () => {
  const b = demoBook();
  const lot = deal(b, "d5");
  const atClosing: Deal = { ...lot, status: "closing", closing: { company: "Sample Title (FAKE)", contact: "Terry", phone: "", email: "t@example.test", fileNumber: "1" } };
  it("a lot purchase, or an absent owner with no mortgage, needs the seller's identity checked before funding", () => {
    expect(sellerCheckNeeded(lot)).toBe(true);
    const house = deal(b, "d16");
    expect(sellerCheckNeeded(house)).toBe(false);
    expect(sellerCheckNeeded({ ...house, seller: { ...lot.seller!, absentee: true, freeAndClear: true } })).toBe(house.app.purpose === "purchase");
    expect(sellerCheckNeeded({ ...lot, app: { ...lot.app, purpose: "refi_rt" } })).toBe(false);
    expect(nextStage(atClosing, evaluate(atClosing.app))?.blockers).toContain("The title company hasn't confirmed it checked the seller's identity independently (vacant land) (Closing tab)");
  });
  it("lists what looks like someone posing as the owner, worst first", () => {
    const flags = sellerFlags(lot, DAY);
    expect(flags.map((flag) => flag.level)).toEqual(["warn", "warn", "warn", "note", "note", "note", "note"]);
    expect(flags[0].text).toMatch(/picked their own notary/);
    expect(flags.map((flag) => flag.text)).toEqual(expect.arrayContaining([expect.stringMatching(/email and texts only/), expect.stringMatching(/Owned since 2004/)]));
    const denied = { ...lot, seller: { ...lot.seller!, rollLetter: { sentOn: "2026-10-20", answer: "denied" as const, answeredOn: "2026-10-25" } } };
    expect(sellerFlags(denied, DAY)[0].level).toBe("stop");
    expect(sellerBlockers(denied)[0]).toMatch(/says they aren't selling/);
    const cheap = { ...lot, seller: undefined, app: { ...lot.app, purchasePrice: 150_000, landValue: 300_000 } };
    expect(sellerFlags(cheap, DAY)[0]).toEqual({ level: "warn", text: "The price is 50% below the land value." });
  });
  it("the title company confirms through its link; the team only on someone's word, saying whose", () => {
    const book: Book = { ...b, deals: b.deals.map((item) => (item.id === "d5" ? atClosing : item)) };
    const verify: BookAction = { t: "verifySeller", dealId: "d5", method: "id_and_selfie", note: "", by: titleCo.name };
    expect(check(book, person("ivy", ["INSPECTOR"]), verify)).toEqual({ error: "Your account can't do that." });
    expect(check(book, owner, verify)).toEqual({ error: expect.stringMatching(/Say who at the title company/) });
    expect(check(book, processor, { ...verify, note: "Terry at Sample Title, by phone, Oct 30" })).toMatchObject({ action: { by: "pat name" } });
    const after = run(book, titleCo, verify, true);
    expect(deal(after, "d5").closing?.sellerVerified).toMatchObject({ method: "id_and_selfie", by: "Terry (title company)" });
    expect(nextStage(deal(after, "d5"), evaluate(lot.app))?.blockers.join(" ")).not.toMatch(/seller's identity/);
    // Saving the closing agent again keeps it.
    const resaved = run(after, owner, { t: "saveClosing", dealId: "d5", closing: { company: "Sample Title (FAKE)", contact: "Terry", phone: "", email: "t@example.test", fileNumber: "2" } });
    expect(deal(resaved, "d5").closing?.sellerVerified?.method).toBe("id_and_selfie");
    expect(titleView(deal(book, "d5"), 1).sellerCheck).toEqual({ done: null });
    expect(titleView(deal(after, "d5"), 1).sellerCheck?.done?.method).toBe("id_and_selfie");
  });
  it("staff enter the seller; nobody else sees it", () => {
    const seller = { name: "Morgan Faraway", mailingAddress: "Albany NY", absentee: true, freeAndClear: true, contact: "phone" as const, notary: "title_company" as const, proceeds: "own_account" as const, rushed: false };
    const save: BookAction = { t: "saveSeller", dealId: "d5", seller, by: "x" };
    expect(check(b, person(BORROWER_ID, ["BORROWER"]), save)).toEqual({ error: "Your account can't do that." });
    expect(check(b, processor, { ...save, seller: { ...seller, name: " " } })).toEqual({ error: expect.stringMatching(/seller's name/) });
    expect(check(b, processor, { ...save, dealId: "d12", seller: seller })).toEqual(deal(b, "d12").app.purpose === "purchase" ? { action: expect.anything() } : { error: "A seller is only on a purchase." });
    const after = run(b, processor, save);
    expect(deal(after, "d5").seller).toMatchObject({ name: "Morgan Faraway", contact: "phone", by: "pat name" });
    expect(scopeBook(after, { id: lot.borrowerId, name: "b", roleCodes: ["BORROWER"] }).deals.find((item) => item.id === "d5")?.seller).toBeUndefined();
  });
});

describe("a title search before each draw (rank 9)", () => {
  const b = demoBook();
  const loan = deal(b, "d12");
  const draw = b.draws.find((item) => item.id === "draw-3")!;
  it("is off until Settings turns it on, which it is unless an owner said no", () => {
    expect(titleUpdateHold(draw, DAY)).toBeNull();
    const base = { nfipAuthorizedThrough: "2026-12-11", drawFeeInspectionCents: 0, drawFeeDeskCents: 0 };
    expect(rulesFrom({ ...base, titleCheckDraws: null }).titleCheck).toEqual({ on: true, minDraw: 0 });
    expect(rulesFrom({ ...base, titleCheckDraws: false, titleCheckMinDrawCents: 2_500_000 }).titleCheck).toEqual({ on: false, minDraw: 25_000 });
  });
  it("holds the draw until a clean search comes back, and a find holds it with what was found", () => {
    setTitleCheckRule({ on: true, minDraw: 0 });
    expect(drawHolds(loan, draw, DAY)).toContain("The title company's search since recording, asked for on October 30, 2026, isn't back yet.");
    expect(titleUpdateHold({ ...draw, titleCheck: undefined }, DAY)).toMatch(/Ask the title company for one/);
    const record = (clean: boolean, through: string, found = ""): BookAction => ({ t: "recordTitleUpdate", drawId: "draw-3", updateId: `u-${through}-${clean}`, clean, through, found, by: "x", via: "title" });
    const found = run(b, titleCo, record(false, "2026-10-29", "Claim of lien, Coastal Roofing (FAKE), OR 12/34"), true);
    const held = found.draws.find((item) => item.id === "draw-3")!;
    expect(drawHolds(loan, held, DAY)).toContain("The title search through October 29, 2026 found something recorded since closing: Claim of lien, Coastal Roofing (FAKE), OR 12/34. Clear it with the title company or the attorney first.");
    const cleared = run(found, owner, record(true, "2026-10-30"));
    const latest = cleared.draws.find((item) => item.id === "draw-3")!;
    expect(latest.titleCheck?.updates.at(-1)).toMatchObject({ clean: true, via: "team", by: "olivia name" });
    expect(titleUpdateHold(latest, DAY)).toBeNull();
    // Too old for a release a month and more later.
    expect(titleUpdateHold(latest, "2026-12-15")).toMatch(/only runs through October 30, 2026/);
  });
  it("skips draws under the owner's threshold, and an owner can still release past it", () => {
    setTitleCheckRule({ on: true, minDraw: 500_000 });
    expect(titleUpdateHold(draw, DAY)).toBeNull();
    setTitleCheckRule({ on: true, minDraw: 0 });
    const hold = titleUpdateHold(draw, DAY)!;
    expect(unreleasedHolds(loan, { ...draw, override: { by: "o", at: "x", reason: "title emailed it", holds: [hold] } }, DAY)).not.toContain(hold);
  });
  it("only the server asks, since asking emails a new link; answers can't predate the mortgage", () => {
    setTitleCheckRule({ on: true, minDraw: 0 });
    const ask: BookAction = { t: "askTitleUpdate", drawId: "draw-3", to: "closer@sample-title.test", by: "olivia name" };
    expect(check(b, owner, ask)).toEqual({ error: "Ask from the draw on the Draws page." });
    expect(deal(b, "d12").lienFile?.mortgageRecordedOn).toBe("2026-04-08");
    expect(check(b, owner, { t: "recordTitleUpdate", drawId: "draw-3", updateId: "u", clean: true, through: "2026-04-01", found: "", by: "x", via: "team" })).toEqual({ error: "The search has to run past the day the mortgage was recorded." });
    expect(check(b, owner, { t: "recordTitleUpdate", drawId: "draw-3", updateId: "u", clean: false, through: "2026-10-30", found: " ", by: "x", via: "team" })).toEqual({ error: expect.stringMatching(/Say what was recorded/) });
    expect(check(b, person(BORROWER_ID, ["BORROWER"]), { t: "recordTitleUpdate", drawId: "draw-3", updateId: "u", clean: true, through: "2026-10-30", found: "", by: "x", via: "team" })).toEqual({ error: "Your account can't do that." });
    const asked = run(b, owner, ask, true);
    expect(asked.draws.find((item) => item.id === "draw-3")!.titleCheck?.asked?.to).toBe("closer@sample-title.test");
  });
  it("the title company sees the open request on its link; the borrower doesn't see the search", () => {
    const view = titleView(loan, 1, b.draws);
    expect(view.updates).toEqual([{ drawId: "draw-3", askedAt: "2026-10-30T14:00:00Z", amount: 120_000, since: "2026-04-08", answered: null }]);
    const mine = scopeBook(b, { id: loan.borrowerId, name: "b", roleCodes: ["BORROWER"] });
    expect(mine.draws.find((item) => item.id === "draw-3")?.titleCheck).toBeUndefined();
  });
});
