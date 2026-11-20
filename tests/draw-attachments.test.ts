import { describe, expect, it } from "vitest";
import { authorize, type Viewer } from "@/lib/book-access";
import { demoBook, reducer, type Book, type BookAction } from "@/lib/book";
import { attachmentProblem, attachmentSummary } from "@/lib/draw-attachments";
import { can, type Permission } from "@/lib/permissions";
import { byteRange, uploadProblem } from "@/lib/uploads";

const check = (b: Book, viewer: Viewer, action: BookAction) => authorize(b, viewer, action, (permission: Permission, amountCents?: number) => can(viewer.roleCodes, permission, { amountCents, member: viewer }), false);
const MB = 1024 * 1024;

describe("receipts and short videos with a draw (rank 30)", () => {
  it("takes up to three short videos and photos or PDFs as receipts", () => {
    expect(attachmentProblem([{ name: "walk.mov", size: 9 * MB, kind: "video" }, { name: "lumber.pdf", size: MB, kind: "receipt" }])).toBeNull();
    expect(attachmentProblem([{ name: "walk.mov", size: 20 * MB, kind: "video" }])).toMatch(/over 15 MB: record about 15 seconds/);
    expect(attachmentProblem(Array.from({ length: 4 }, (_, index) => ({ name: `clip${index}.mp4`, size: MB, kind: "video" as const })))).toBe("Send up to 3 short videos.");
    expect(attachmentProblem([{ name: "walk.avi", size: MB, kind: "video" }])).toBe("Videos go as MP4, MOV or WebM.");
    expect(attachmentProblem([{ name: "receipt.docx", size: MB, kind: "receipt" }])).toBe("Receipts go as photos or PDFs.");
    expect(attachmentSummary([{ id: "a", kind: "video", name: "v.mp4", at: "x" }, { id: "b", kind: "receipt", name: "r.pdf", at: "x" }, { id: "c", kind: "receipt", name: "s.pdf", at: "x" }])).toBe("With the request: 1 video and 2 receipts.");
  });

  it("checks a video is one by its contents", () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom", "latin1"), Buffer.alloc(32)]);
    expect(uploadProblem("walk.mp4", mp4.length, mp4)).toBeNull();
    expect(uploadProblem("walk.mov", mp4.length, mp4)).toBeNull();
    expect(uploadProblem("walk.mp4", 10, Buffer.from("not a video"))).toBe("The file contents do not match its type.");
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]);
    expect(uploadProblem("walk.webm", webm.length, webm)).toBeNull();
  });

  it("serves a video in pieces for the phones that ask", () => {
    expect(byteRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(byteRange("bytes=0-1", 1000)).toEqual({ start: 0, end: 1 });
    expect(byteRange("bytes=500-2000", 1000)).toEqual({ start: 500, end: 999 });
    expect(byteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange("bytes=2000-", 1000)).toBeNull();
    expect(byteRange(null, 1000)).toBeNull();
  });

  it("keeps them on the draw the borrower asks for", () => {
    const b = demoBook();
    const deal = b.deals.find((item) => item.id === "d2")!;
    const borrower: Viewer = { id: deal.borrowerId, name: "Alex", roleCodes: ["BORROWER"] };
    const ask: BookAction = { t: "requestDraw", dealId: deal.id, by: "", note: "Kitchen cabinets in", contact: "Alex 555-0100", photos: [], lines: [{ scopeId: "kitchen", requested: 5_000 }], attachments: [{ kind: "video", name: "kitchen.mov" }, { kind: "receipt", name: "cabinets.pdf" }], path: "inspector" };
    expect(check(b, borrower, ask)).toHaveProperty("action");
    expect(check(b, borrower, { ...ask, attachments: [{ kind: "video", name: "kitchen.avi" }] } as BookAction)).toEqual({ error: "Videos go as MP4, MOV or WebM." });
    expect(check(b, borrower, { ...ask, attachments: [{ kind: "receipt", name: "cabinets.pdf", documentId: "doc-elsewhere" }] } as BookAction)).toEqual({ error: "A file on this draw wasn't uploaded with it. Try again." });
    const next = reducer(b, { ...ask, by: "Alex" } as BookAction);
    expect(next.draws[0]).toMatchObject({ dealId: deal.id, attachments: [{ kind: "video", name: "kitchen.mov" }, { kind: "receipt", name: "cabinets.pdf" }] });
  });
});
