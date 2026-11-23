import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { sendAlerts } from "@/lib/book-alerts";
import { runAction } from "@/lib/book-store";
import { encryptField } from "@/lib/crypto";
import { agentChecks, agentPolicyProblem, agentView, type AgentPolicyInput } from "@/lib/insurance-agent";
import { agentActor, openInsuranceLink } from "@/lib/insurance-links";
import type { PolicyKind } from "@/lib/mockData";
import { checkPdf } from "@/lib/pdf-signals";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { servicingDate } from "@/lib/servicing";
import { extensionOf, mimeFor, putBytes, safeBasename } from "@/lib/storage";
import { attachmentName, documentNameContext, uploadProblem } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const field = (form: FormData, name: string, max = 600) => String(form.get(name) ?? "").trim().slice(0, max);

/**
 * The borrower's insurance agent sends one policy: what its declarations page says, and the binder or declarations page
 * itself. It's checked against the loan (lib/insurance-agent.ts), stored encrypted like every loan file, and lands for
 * the team to open and accept or send back.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (Number(request.headers.get("content-length") ?? 0) > 16 * 1024 * 1024) return refuse("That file is too large. The limit is 15 MB.", 413);
  const link = await openInsuranceLink((await params).token);
  if (!link) return refuse("This link has expired or isn't valid. Ask LendHous or the borrower for a new one.", 404);
  if (link.state !== "open") return refuse("This link has been turned off. Ask LendHous or the borrower for a new one.", 410);
  if (!(await consumeRateLimit(`insurance-link:${link.deal.id}`, 60, 60 * 60 * 1000))) return refuse("Too many uploads at once. Wait a minute and try again.", 429);
  const form = await request.formData().catch(() => null);
  if (!form) return refuse("Choose a file.", 400);
  const coverage = Number(field(form, "coverage", 20).replace(/[$,\s]/g, ""));
  const program = field(form, "program", 10);
  const input: AgentPolicyInput = {
    kind: field(form, "kind", 20) as PolicyKind, carrier: field(form, "carrier", 160), policy: field(form, "policy", 160),
    effectiveOn: field(form, "effectiveOn", 10), expiresOn: field(form, "expiresOn", 10), coverage: Number.isFinite(coverage) && coverage > 0 ? coverage : undefined,
    windIncluded: form.get("windIncluded") === "yes", ...(program === "nfip" || program === "private" ? { program } : {}),
    namedInsured: field(form, "namedInsured", 160), clause: field(form, "clause", 600),
  };
  const problem = agentPolicyProblem(link.view, input);
  if (problem) return refuse(problem, 400);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return refuse("Attach the binder or the declarations page.", 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  const refused = uploadProblem(file.name, file.size, bytes);
  if (refused) return refuse(refused, 400);

  const today = servicingDate(new Date());
  const checks = agentChecks(link.view, input, today);
  const id = randomUUID();
  const ext = extensionOf(file.name)!;
  const key = `loans/${safeBasename(link.deal.id)}/${id}.${ext}`;
  const name = attachmentName(file.name);
  const fileKeyId = await putBytes(key, bytes);
  await prisma.document.create({ data: { id, ownerType: "LOAN", ownerId: link.deal.id, documentType: "insurance_agent", originalName: encryptField(name, documentNameContext(id)), storageKey: key, fileKeyId, mime: mimeFor(ext, file.type), size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
  const actor = agentActor(link.deal);
  const saved = await runAction(actor, { t: "agentPolicy", dealId: link.deal.id, renewalId: `ren${randomUUID()}`, policy: input, checks, fileName: name, documentId: id, by: actor.name }, { trusted: true });
  if ("error" in saved) {
    await prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
    return refuse(saved.error, 409);
  }
  if (ext === "pdf") await runAction(actor, { t: "recordFileCheck", dealId: link.deal.id, check: checkPdf(bytes, { documentId: id, fileName: name, label: "Insurance from the agent", at: new Date().toISOString() }) }, { trusted: true }).catch(() => null);
  await sendAlerts(saved.before, saved.after, saved.action).catch(() => {});
  await audit({ actorId: null, action: "document.uploaded", entityType: "Document", entityId: id, after: { dealId: link.deal.id, by: "insurance-link", documentType: "insurance_agent", size: bytes.length } });
  const deal = saved.after.deals.find((item) => item.id === link.deal.id)!;
  return NextResponse.json({ view: agentView(deal) });
}
