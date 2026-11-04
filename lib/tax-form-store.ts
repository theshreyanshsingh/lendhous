// Keeps the W-9s and W-8s partners, buyers and brokers sign in the portal (lib/tax-forms.ts), sealed like the SSNs in
// signed applications: a form's TIN only leaves here for the year-end export, which takes reveal_sensitive.
import { randomUUID } from "node:crypto";
import { encryptField, readField } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { w8ExpiresOn, type OnFile, type W8, type W9 } from "@/lib/tax-forms";

export type Payee = { type: "partner" | "buyer" | "broker"; id: string };
const context = (id: string) => `TaxForm.data:${id}`;

export async function saveTaxForm(payee: Payee, form: { kind: "w9"; data: W9 } | { kind: "w8"; data: W8 }, signedName: string, ip: string, now = new Date()) {
  const id = randomUUID();
  await prisma.taxForm.create({ data: { id, ownerType: payee.type, ownerId: payee.id, kind: form.kind, data: encryptField(JSON.stringify(form.data), context(id)), signedName: encryptField(signedName, `TaxForm.signedName:${id}`), signedAt: now, ip, expiresOn: form.kind === "w8" ? w8ExpiresOn(now.toISOString().slice(0, 10)) : null } });
  return id;
}

type Row = Awaited<ReturnType<typeof prisma.taxForm.findFirst>>;
const openRow = (row: NonNullable<Row>): OnFile => {
  const data = JSON.parse(readField(row.data, context(row.id)));
  return row.kind === "w8" ? { kind: "w8", form: data as W8, signedAt: row.signedAt.toISOString(), expiresOn: row.expiresOn ?? "" } : { kind: "w9", form: data as W9, signedAt: row.signedAt.toISOString() };
};

/** The form on file for a payee: the newest one, unless it's a W-8 past its expiry. */
export async function currentTaxForm(payee: Payee, today = new Date().toISOString().slice(0, 10)): Promise<OnFile> {
  const row = await prisma.taxForm.findFirst({ where: { ownerType: payee.type, ownerId: payee.id }, orderBy: { signedAt: "desc" } });
  if (!row || (row.kind === "w8" && row.expiresOn && row.expiresOn < today)) return null;
  return openRow(row);
}

/** Every payee's current form, for the year-end screen. */
export async function allTaxForms(today = new Date().toISOString().slice(0, 10)) {
  const rows = await prisma.taxForm.findMany({ orderBy: { signedAt: "asc" } });
  const latest = new Map<string, NonNullable<Row>>();
  for (const row of rows) latest.set(`${row.ownerType}:${row.ownerId}`, row);
  return new Map([...latest].filter(([, row]) => !(row.kind === "w8" && row.expiresOn && row.expiresOn < today)).map(([key, row]) => [key, openRow(row)]));
}
