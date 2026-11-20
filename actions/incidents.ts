"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { DATA_KINDS, incidentProblem, stepProblem, STEP_DONE, type DataKind, type IncidentInput, type IncidentStep } from "@/lib/breach";
import { isDemoEmail } from "@/lib/deploy";
import { changeIncident, createIncident } from "@/lib/incident-store";
import { servicingDate } from "@/lib/servicing";

const PAGE = "/admin/incidents";
const str = (formData: FormData, key: string, max = 2000) => String(formData.get(key) ?? "").trim().slice(0, max);
const day = (formData: FormData, key: string) => { const value = str(formData, key, 10); return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined; };
const count = (formData: FormData, key: string) => { const value = str(formData, key, 12).replace(/[,\s]/g, ""); return value === "" ? undefined : Number(value); };
const back = (params: Record<string, string>) => redirect(`${PAGE}?${new URLSearchParams(params)}`);
/** The person, if they may record incidents; demo seats look but keep nothing. */
async function recorder() {
  const actor = await requirePermission("manage_incidents");
  if (isDemoEmail(actor.email)) back({ error: "Demo seats can look around here but don't record incidents." });
  return actor;
}

function inputFrom(formData: FormData): IncidentInput {
  const source = formData.get("source") === "agent" ? "agent" : "lendhous";
  const harm = (["likely", "unlikely"] as const).find((value) => value === formData.get("harm")) ?? "undetermined";
  const agency = str(formData, "delayAgency", 200);
  const until = day(formData, "delayUntil");
  return {
    title: str(formData, "title", 160), discoveredOn: str(formData, "discoveredOn", 10), occurredFrom: day(formData, "occurredFrom"), occurredTo: day(formData, "occurredTo"),
    source, ...(source === "agent" ? { agent: str(formData, "agent", 160), agentFoundOn: day(formData, "agentFoundOn"), agentToldOn: day(formData, "agentToldOn") } : {}),
    synopsis: str(formData, "synopsis", 4000), dataKinds: formData.getAll("dataKinds").map(String).filter((kind): kind is DataKind => kind in DATA_KINDS),
    floridians: count(formData, "floridians") ?? NaN, notified: count(formData, "notified"),
    harm, ...(harm === "unlikely" ? { harmDecidedOn: day(formData, "harmDecidedOn"), harmReason: str(formData, "harmReason", 4000) } : {}),
    ...(agency || until ? { lawDelay: { agency, until: until ?? "" } } : {}),
  };
}

/** Records a new incident, or saves changes to one. */
export async function saveIncident(formData: FormData) {
  const actor = await recorder();
  const today = servicingDate(new Date());
  const input = inputFrom(formData);
  const problem = incidentProblem(input, today);
  const id = str(formData, "id", 64);
  if (problem) back({ error: problem, ...(id ? { open: id } : { new: "1" }) });
  if (!id) {
    const incident = await createIncident(input, actor.name);
    await audit({ actorId: actor.id, action: "incident.created", entityType: "SecurityIncident", entityId: incident.id });
    back({ open: incident.id, notice: "Incident recorded. Its deadlines are below." });
  }
  const changed = await changeIncident(id, (incident) => ({ ...incident, ...input }));
  if (!changed) back({ error: "That incident is gone." });
  await audit({ actorId: actor.id, action: "incident.updated", entityType: "SecurityIncident", entityId: id });
  revalidatePath(PAGE);
  back({ open: id, notice: "Saved." });
}

/** Marks a notice sent, good cause given, or the incident closed, on a day. */
export async function markIncidentStep(formData: FormData) {
  const actor = await recorder();
  const today = servicingDate(new Date());
  const id = str(formData, "id", 64);
  const step = str(formData, "step", 20) as IncidentStep;
  const on = str(formData, "on", 10) || today;
  if (!(step in STEP_DONE)) back({ open: id, error: "Choose what was done." });
  let refused: string | null = null;
  const changed = await changeIncident(id, (incident) => {
    refused = stepProblem(incident, step, on, today);
    return refused ? incident : { ...incident, done: { ...incident.done, [step]: on } };
  });
  if (!changed) back({ error: "That incident is gone." });
  if (refused) back({ open: id, error: refused });
  await audit({ actorId: actor.id, action: `incident.${step}`, entityType: "SecurityIncident", entityId: id, after: { on } });
  revalidatePath(PAGE);
  back({ open: id, notice: `${STEP_DONE[step]} on ${on}.` });
}

/** Adds a line to the incident's log of what was done to contain it and protect the data. */
export async function addIncidentMeasure(formData: FormData) {
  const actor = await recorder();
  const today = servicingDate(new Date());
  const id = str(formData, "id", 64);
  const text = str(formData, "text", 1000);
  const on = day(formData, "on") ?? today;
  if (!text) back({ open: id, error: "Say what was done." });
  if (on > today) back({ open: id, error: "Enter a day today or earlier." });
  const changed = await changeIncident(id, (incident) => ({ ...incident, measures: [...incident.measures, { on, text, by: actor.name }] }));
  if (!changed) back({ error: "That incident is gone." });
  await audit({ actorId: actor.id, action: "incident.measure", entityType: "SecurityIncident", entityId: id });
  revalidatePath(PAGE);
  back({ open: id, notice: "Added to the log." });
}
