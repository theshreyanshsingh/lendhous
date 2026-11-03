import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import type { Viewer } from "@/lib/book-access";
import { sendAlerts } from "@/lib/book-alerts";
import { readBook, runAction } from "@/lib/book-store";
import { encryptField } from "@/lib/crypto";
import { notify } from "@/lib/email";
import { dueOf, longDay, matchLoan, publicRequestProblem, receivedOf } from "@/lib/payoffs";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";
import { SERVICED, servicingDate } from "@/lib/servicing";
import { extensionOf, mimeFor, putBytes, safeBasename } from "@/lib/storage";
import { attachmentName, documentNameContext, uploadProblem } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const refuse = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const AUTHORIZATION_TYPES = new Set(["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif"]);

/**
 * The public payoff request form (Fla. Stat. 701.04(1)): the borrower, or someone with their written authorization, asks
 * for a payoff letter without an account. It counts as received the day it's sent, so it's logged at once with its due
 * date, the team and (for anyone else asking) the borrower are told, and staff check it and send the letter.
 */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 11 * 1024 * 1024) return refuse("That file is too large. The limit is 10 MB.", 413);
  const meta = await requestMeta();
  const shared = /^(unknown|127\.|::1$|::ffff:127\.)/.test(meta.ipAddress);
  if (!(await consumeRateLimit(`payoff-form:${meta.ipAddress}`, shared ? 60 : 8, 60 * 60 * 1000))) return refuse("Too many requests from this connection. Try again in an hour, or email us.", 429);
  const form = await request.formData().catch(() => null);
  if (!form) return refuse("That didn't come through. Try again.");
  // The same honeypot as the quote form: a bot fills every field.
  if (String(form.get("website") || "")) return NextResponse.json({ ok: true, receivedOn: "", dueBy: "" });
  const today = servicingDate(new Date());
  const field = (name: string) => String(form.get(name) ?? "");
  const checked = publicRequestProblem({ loanNumber: field("loanNumber"), zip: field("zip"), kind: field("kind"), name: field("name"), company: field("company"), email: field("email"), phone: field("phone"), fileNumber: field("fileNumber"), goodThrough: field("goodThrough"), note: field("note") }, today);
  if ("error" in checked) return refuse(checked.error);
  const fields = checked.request;

  const deal = matchLoan((await readBook()).book.deals, fields.loanNumber, fields.zip);
  // Mortgages are public record, so saying a loan wasn't found gives nothing away; the figures stay behind the check.
  // A mistyped number is an answer, not a failure, so it comes back as one (and the browser logs no error).
  if (!deal) return NextResponse.json({ error: "We couldn't find a loan with that number and ZIP code. Check them against the borrower's statement or loan documents, or email us the request." }, { headers: { "Cache-Control": "no-store" } });
  if (!SERVICED.includes(deal.status)) return NextResponse.json({ error: "That loan isn't open for payoff requests. It may already be paid off. Contact LendHous servicing." }, { headers: { "Cache-Control": "no-store" } });

  const file = form.get("authorization");
  let check: { status: "pending" | "accepted"; note: string; documentId?: string; fileName?: string };
  if (fields.kind === "borrower") {
    // A letter that goes to the borrower's own sign-in email can only reach them. Any other address needs a call first.
    const account = deal.borrowerId ? await prisma.user.findUnique({ where: { id: deal.borrowerId }, select: { email: true } }) : null;
    check = account && account.email.toLowerCase() === fields.email.toLowerCase() ? { status: "accepted", note: "Sent from the borrower's sign-in email." } : { status: "pending", note: "That isn't the email on the borrower's account. Confirm it's them, at a number already on file, before the letter goes out." };
  } else {
    if (!(file instanceof File) || file.size === 0) return refuse("Attach the borrower's signed authorization for you to ask for the payoff.");
    if (!AUTHORIZATION_TYPES.has(extensionOf(file.name) ?? "")) return refuse("Send the authorization as a PDF or a photo.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const problem = uploadProblem(file.name, file.size, bytes, 10 * 1024 * 1024);
    if (problem) return refuse(problem);
    const id = randomUUID();
    const ext = extensionOf(file.name)!;
    const key = `loans/${safeBasename(deal.id)}/${id}.${ext}`;
    const name = attachmentName(file.name);
    const fileKeyId = await putBytes(key, bytes);
    await prisma.document.create({ data: { id, ownerType: "LOAN", ownerId: deal.id, documentType: "payoff_authorization", originalName: encryptField(name, documentNameContext(id)), storageKey: key, fileKeyId, mime: mimeFor(ext, file.type), size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
    check = { status: "pending", note: "Signed authorization uploaded with the request.", documentId: id, fileName: name };
  }

  const requester = { kind: fields.kind, name: fields.name, email: fields.email.toLowerCase(), ...(fields.company ? { company: fields.company } : {}), ...(fields.phone ? { phone: fields.phone } : {}), ...(fields.fileNumber ? { fileNumber: fields.fileNumber } : {}) };
  const actor: Viewer = { id: "payoff-form", name: `${fields.name} (payoff request form)`, roleCodes: [] };
  const saved = await runAction(actor, { t: "submitPayoffRequest", dealId: deal.id, goodThrough: fields.goodThrough, sentOn: today, requester, check, note: fields.note }, { trusted: true });
  if ("error" in saved) {
    if (check.documentId) await prisma.document.update({ where: { id: check.documentId }, data: { deletedAt: new Date() } });
    return refuse("We couldn't take this just now. Please try again in a few minutes.", 409);
  }
  const payoff = saved.after.payoffs.find((item) => !saved.before.payoffs.some((old) => old.id === item.id))!;
  await audit({ actorId: null, action: "payoff.requested", entityType: "LoanBook", entityId: deal.id, after: { payoffId: payoff.id, kind: fields.kind, channel: "web_form" } });
  await sendAlerts(saved.before, saved.after, saved.action);
  const receivedOn = receivedOf(payoff);
  const dueBy = dueOf(payoff);
  await notify(requester.email, `We have your payoff request: ${deal.loanNumber}`, `Hi ${fields.name.split(" ")[0]},\n\nWe received your request for a payoff letter on ${deal.address}, ${deal.city} (${deal.loanNumber}), good through ${longDay(fields.goodThrough)}. It counts as received ${longDay(receivedOn)}, and we'll email the letter to this address by ${longDay(dueBy)}, usually much sooner.\n\nWe never send wire instructions by email. If an email ever asks you to wire money to new instructions, call us at a number you find yourself.`, { eventCode: "payoff.received" }).catch(() => {});
  return NextResponse.json({ ok: true, receivedOn, dueBy }, { headers: { "Cache-Control": "no-store" } });
}
