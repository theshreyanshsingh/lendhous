"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { hasPermission, requirePermission, requireUser } from "@/lib/auth";
import { firmOf } from "@/lib/book-access";
import { readBook } from "@/lib/book-store";
import { toCsv } from "@/lib/csv";
import { isDemoEmail } from "@/lib/deploy";
import { viewFor } from "@/lib/permissions";
import { requestMeta } from "@/lib/request-meta";
import { allTaxForms, currentTaxForm, saveTaxForm, type Payee } from "@/lib/tax-form-store";
import { CLASSIFICATIONS, irisRows, maskTin, taxYear, w9Problem, type Classification, type FormLine, type W8, type W9 } from "@/lib/tax-forms";

/** The signed-in partner, buyer or broker as a payee, or an error. */
async function payee() {
  const user = await requireUser();
  const view = viewFor(user.roleCodes);
  if (view !== "partner" && view !== "buyer" && view !== "broker") return { error: "Only partners, loan buyers and brokers give LendHous a tax form." } as const;
  if (isDemoEmail(user.email)) return { error: "Demo accounts can't file tax forms." } as const;
  return { user, payee: { type: view, id: firmOf(user) } as Payee } as const;
}

/** What's on file for the signed-in payee, with the TIN masked. */
export async function myTaxForm() {
  const who = await payee();
  if ("error" in who) return null;
  const form = await currentTaxForm(who.payee);
  if (!form) return null;
  return form.kind === "w9" ? { kind: "w9" as const, name: form.form.legalName, classification: CLASSIFICATIONS[form.form.classification], tin: maskTin(form.form.tin), signedAt: form.signedAt } : { kind: "w8" as const, name: form.form.name, country: form.form.country, signedAt: form.signedAt, expiresOn: form.expiresOn };
}

/** A W-9 signed in the portal: the IRS's certification, typed name and all. */
export async function submitW9(raw: W9, signedName: string, certified: boolean): Promise<{ error?: string }> {
  const who = await payee();
  if ("error" in who) return { error: who.error };
  const form: W9 = {
    legalName: String(raw.legalName ?? "").trim().slice(0, 120), businessName: String(raw.businessName ?? "").trim().slice(0, 120),
    classification: (Object.keys(CLASSIFICATIONS).includes(raw.classification) ? raw.classification : "other") as Classification,
    tinType: raw.tinType === "ein" ? "ein" : "ssn", tin: String(raw.tin ?? "").replace(/\D/g, "").slice(0, 9), exemptPayeeCode: String(raw.exemptPayeeCode ?? "").trim().slice(0, 4),
    address: { street: String(raw.address?.street ?? "").trim().slice(0, 160), city: String(raw.address?.city ?? "").trim().slice(0, 80), state: String(raw.address?.state ?? "").trim().toUpperCase().slice(0, 2), zip: String(raw.address?.zip ?? "").trim().slice(0, 10) },
  };
  const problem = w9Problem(form);
  if (problem) return { error: problem };
  if (!certified) return { error: "Check the box to certify what you've entered." };
  if (!signedName.trim()) return { error: "Type your name to sign." };
  const id = await saveTaxForm(who.payee, { kind: "w9", data: form }, signedName.trim().slice(0, 120), (await requestMeta()).ipAddress);
  await audit({ actorId: who.user.id, action: "tax.w9_received", entityType: "TaxForm", entityId: id, after: { payee: who.payee.type } });
  revalidatePath("/admin/account/tax");
  return {};
}

/** A foreign person's W-8BEN or W-8BEN-E: what's needed for the CPA to handle 1042-S withholding. */
export async function submitW8(raw: W8, signedName: string, certified: boolean): Promise<{ error?: string }> {
  const who = await payee();
  if ("error" in who) return { error: who.error };
  const form: W8 = { name: String(raw.name ?? "").trim().slice(0, 120), entity: Boolean(raw.entity), country: String(raw.country ?? "").trim().slice(0, 60), foreignTin: String(raw.foreignTin ?? "").trim().slice(0, 40), address: String(raw.address ?? "").trim().slice(0, 240) };
  if (!form.name || !form.country || !form.address) return { error: "Enter the name, country and permanent address." };
  if (!certified) return { error: "Check the box to certify what you've entered." };
  if (!signedName.trim()) return { error: "Type your name to sign." };
  const id = await saveTaxForm(who.payee, { kind: "w8", data: form }, signedName.trim().slice(0, 120), (await requestMeta()).ipAddress);
  await audit({ actorId: who.user.id, action: "tax.w8_received", entityType: "TaxForm", entityId: id, after: { payee: who.payee.type } });
  revalidatePath("/admin/account/tax");
  return {};
}

const onFileFrom = (forms: Awaited<ReturnType<typeof allTaxForms>>) => (type: string, id: string) => forms.get(`${type}:${id}`) ?? null;

/** A tax year's forms for the owners' screen: amounts and what's on file, never a TIN. */
export async function taxYearReport(year: number): Promise<{ lines: FormLine[]; deadlines: ReturnType<typeof taxYear>["deadlines"] }> {
  await requirePermission("manage_roles");
  const report = taxYear((await readBook()).book, year, onFileFrom(await allTaxForms()));
  return { lines: report.lines, deadlines: report.deadlines };
}

/** The forms due as a CSV for IRIS, with full TINs: owners with reveal_sensitive only, and every export is logged. */
export async function exportIris(year: number): Promise<{ csv?: string; error?: string }> {
  const actor = await requirePermission("manage_roles");
  if (!(await hasPermission(actor, "reveal_sensitive"))) return { error: "Exporting TINs takes the permission to reveal sensitive numbers." };
  const forms = await allTaxForms();
  const report = taxYear((await readBook()).book, year, onFileFrom(forms));
  const rows = irisRows(report.lines, (line) => {
    const form = forms.get(`${line.payeeType}:${line.payeeId}`);
    return form?.kind === "w9" ? { tinType: form.form.tinType, tin: form.form.tin, name: form.form.legalName, ...form.form.address } : null;
  }, year);
  if (!rows.length) return { error: `No forms are due for ${year}.` };
  await audit({ actorId: actor.id, action: "pii.revealed", entityType: "TaxYear", entityId: String(year), after: { field: "tin", forms: rows.length } });
  return { csv: toCsv(rows) };
}
