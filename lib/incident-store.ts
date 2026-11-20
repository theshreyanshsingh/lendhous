// Security incidents, each kept encrypted whole and bound to its id (lib/breach.ts for the rules).
import { encryptField, readField } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import type { Incident, IncidentInput } from "@/lib/breach";

const context = (id: string) => `SecurityIncident:${id}`;
const open = (row: { id: string; data: string }) => JSON.parse(readField(row.data, context(row.id))) as Incident;
const seal = (incident: Incident) => encryptField(JSON.stringify(incident), context(incident.id));

/** Every incident, open ones first, newest first within each. */
export async function listIncidents(): Promise<Incident[]> {
  const rows = await prisma.securityIncident.findMany({ orderBy: [{ closed: "asc" }, { createdAt: "desc" }], take: 200 });
  return rows.map(open);
}

export async function createIncident(input: IncidentInput, by: string): Promise<Incident> {
  const id = crypto.randomUUID();
  const incident: Incident = { ...input, id, done: {}, measures: [], by, at: new Date().toISOString() };
  await prisma.securityIncident.create({ data: { id, data: seal(incident), closed: false } });
  return incident;
}

/** Changes one incident: read, change and write back. Null when it's gone. */
export async function changeIncident(id: string, change: (incident: Incident) => Incident): Promise<{ before: Incident; after: Incident } | null> {
  const row = await prisma.securityIncident.findUnique({ where: { id } });
  if (!row) return null;
  const before = open(row);
  const after = change(before);
  await prisma.securityIncident.update({ where: { id }, data: { data: seal(after), closed: Boolean(after.done.closed) } });
  return { before, after };
}
