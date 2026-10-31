"use client";

// Laid out like SynergyFund's members page: a count of people, one row each, and a sheet to invite or change someone.
import { useActionState, useEffect, useMemo, useState } from "react";
import type { RoleCode } from "@prisma/client";
import { deleteMember, saveMember, sendNewLink, type MemberFormState } from "@/actions/members";
import { PageIntro } from "@/components/page-intro";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { accessFor, isOwner, PERMISSION_GROUPS, ROLE_GROUPS } from "@/lib/member-rules";
import { PERMISSIONS, ROLE_LABEL, type Permission } from "@/lib/permissions";

export type MemberRow = { id: string; name: string; email: string; title: string; roles: RoleCode[]; extraPermissions: string[]; deniedPermissions: string[]; signedIn: boolean };

type Draft = { id: string; name: string; email: string; title: string; roles: RoleCode[]; permissions: string[] };

const blank = (): Draft => ({ id: "", name: "", email: "", title: "", roles: ["PROCESSOR"], permissions: accessFor(["PROCESSOR"]) });
const custom = (row: MemberRow) => row.extraPermissions.length > 0 || row.deniedPermissions.length > 0;
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
const sheetClass = "w-full! gap-0! overflow-y-auto p-0 sm:max-w-lg!";

export function MembersBoard({ rows, meId, meIsOwner }: { rows: MemberRow[]; meId: string; meIsOwner: boolean }) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [issued, setIssued] = useState<MemberFormState["issued"]>();
  const shown = useMemo(() => rows.filter((row) => `${row.name} ${row.email} ${row.title}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);
  const stats = [
    { label: "People", value: rows.length, hint: "With an account" },
    { label: "Owners", value: rows.filter((row) => isOwner(row.roles)).length, hint: "Can do everything" },
    { label: "Waiting", value: rows.filter((row) => !row.signedIn).length, hint: "Haven't signed in yet" },
    { label: "Custom access", value: rows.filter(custom).length, hint: "Changed from the role" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0"><PageIntro eyebrow="Account" title="Members" lede="Everyone with an account. Invite people, choose their role, and change what they can do." /></div>
        <button type="button" className="btn-primary mb-6 w-full sm:w-auto" data-testid="invite-member" onClick={() => setDraft(blank())}>Invite member</button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => <div key={stat.label} className="glass min-w-0 p-4"><div className="text-xs text-muted-foreground">{stat.label}</div><div className="font-heading text-2xl font-semibold">{stat.value}</div><div className="text-xs text-faint">{stat.hint}</div></div>)}
      </div>
      <div className="glass overflow-hidden">
        <div className="border-b border-border p-3"><input className="desk-input w-full sm:w-72" placeholder="Search name, email or title" aria-label="Search members" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <div className="px-4 lg:px-0">
          <table className="stack-table w-full" data-testid="members-table">
            <thead><tr className="border-b border-rule"><th>Name</th><th>Role</th><th>Access</th><th>Title</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={6} className="text-muted-foreground">No members match this search.</td></tr>}
              {shown.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0" data-testid="member-row">
                  <td>
                    <span className="flex items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{initials(row.name)}</span>
                      <span className="min-w-0"><strong className="block font-medium wrap-anywhere">{row.name}</strong><small className="block text-xs wrap-anywhere text-muted-foreground">{row.email}</small></span>
                    </span>
                  </td>
                  <td data-label="Role"><span className="flex flex-wrap justify-end gap-1 lg:justify-start">{row.roles.map((role) => <Badge key={role}>{ROLE_LABEL[role]}</Badge>)}</span></td>
                  <td data-label="Access">{custom(row) ? <Badge tone="violet">Custom</Badge> : <span className="text-muted-foreground">Role default</span>}</td>
                  {row.title ? <td data-label="Title">{row.title}</td> : <td className="hidden lg:table-cell">—</td>}
                  <td data-label="Status">{row.signedIn ? <span className="text-muted-foreground">Active</span> : <Badge tone="amber">Invited</Badge>}</td>
                  <td>
                    <span className="flex gap-2 pt-1 lg:justify-end lg:pt-0">
                      <button type="button" className="btn-ghost h-9! flex-1 px-3! text-xs! lg:flex-none" data-testid="modify-member" onClick={() => setDraft({ id: row.id, name: row.name, email: row.email, title: row.title, roles: row.roles, permissions: accessFor(row.roles, row) })}>Modify</button>
                      <button type="button" className="btn-ghost h-9! flex-1 px-3! text-xs! text-bad lg:flex-none" data-testid="remove-member" disabled={row.id === meId} onClick={() => setRemoving(row)}>Remove</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {draft && <MemberSheet key={draft.id || "new"} draft={draft} meId={meId} meIsOwner={meIsOwner} onChange={setDraft} onClose={() => setDraft(null)} onIssued={(next) => { setDraft(null); setIssued(next); }} />}
      {removing && <RemoveSheet row={removing} onClose={() => setRemoving(null)} />}
      {issued && <IssuedSheet issued={issued} onClose={() => setIssued(undefined)} />}
    </div>
  );
}

function SheetHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="border-b border-border p-5 pr-12">
      <p className="eyebrow">{eyebrow}</p>
      <SheetTitle className="mt-2 font-heading text-2xl font-normal text-foreground wrap-anywhere">{title}</SheetTitle>
      {children && <div className="mt-2 text-sm text-muted-foreground wrap-anywhere">{children}</div>}
    </header>
  );
}

function MemberSheet({ draft, meId, meIsOwner, onChange, onClose, onIssued }: { draft: Draft; meId: string; meIsOwner: boolean; onChange: (draft: Draft) => void; onClose: () => void; onIssued: (issued: NonNullable<MemberFormState["issued"]>) => void }) {
  const [state, action] = useActionState(saveMember, {} as MemberFormState);
  const [linkState, linkAction] = useActionState(sendNewLink, {} as MemberFormState);
  const editing = Boolean(draft.id);
  const isSelf = draft.id === meId;
  const owner = isOwner(draft.roles);
  useEffect(() => { if (state.saved) onClose(); }, [state.saved, onClose]);
  useEffect(() => { if (state.issued) onIssued(state.issued); }, [state.issued, onIssued]);
  useEffect(() => { if (linkState.issued) onIssued(linkState.issued); }, [linkState.issued, onIssued]);
  // Choosing roles resets the ticks to what those roles allow, as SynergyFund's role picker does.
  const toggleRole = (role: RoleCode) => {
    const roles = draft.roles.includes(role) ? draft.roles.filter((item) => item !== role) : [...draft.roles, role];
    onChange({ ...draft, roles, permissions: accessFor(roles) });
  };
  const togglePermission = (permission: Permission) => onChange({ ...draft, permissions: draft.permissions.includes(permission) ? draft.permissions.filter((item) => item !== permission) : [...draft.permissions, permission] });
  const defaults = accessFor(draft.roles);
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className={sheetClass}>
        <SheetHead eyebrow="Members" title={editing ? draft.name : "Invite a member"}>{editing ? draft.email : "They get an email with a one-time link to set their own password."}</SheetHead>
        <form action={action} className="flex min-h-0 flex-1 flex-col" data-testid="member-form">
          <input type="hidden" name="id" value={draft.id} />
          {draft.roles.map((role) => <input key={role} type="hidden" name="roles" value={role} />)}
          {draft.permissions.map((permission) => <input key={permission} type="hidden" name="permissions" value={permission} />)}
          <div className="flex-1 space-y-5 p-5">
            {(state.error || linkState.error) && <p role="alert" className="rounded-[2px] border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{state.error || linkState.error}</p>}
            {isSelf && <p className="text-sm text-muted-foreground">This is your own account. Another admin has to change your access.</p>}
            {!editing && (
              <>
                <label className="block"><span className="label">Name</span><input data-testid="member-name" name="name" className="desk-input" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} required /></label>
                <label className="block"><span className="label">Email</span><input data-testid="member-email" name="email" type="email" className="desk-input" value={draft.email} onChange={(event) => onChange({ ...draft, email: event.target.value })} required /></label>
              </>
            )}
            <label className="block"><span className="label">Title</span><input data-testid="member-title" name="title" className="desk-input" placeholder="Optional" value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} /></label>
            <fieldset disabled={isSelf} className="space-y-3">
              <legend className="label">Role</legend>
              {ROLE_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-1.5 text-xs text-faint">{group.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.roles.map((role) => {
                      const on = draft.roles.includes(role);
                      const locked = role === "ADMIN_OWNER" && !meIsOwner;
                      return <button key={role} type="button" disabled={locked} aria-pressed={on} data-testid={`role-${role}`} onClick={() => toggleRole(role)} className={`min-h-9 rounded-[2px] border px-3 py-1.5 text-[13px] disabled:opacity-40 ${on ? "border-primary bg-primary text-primary-foreground" : "border-rule text-foreground hover:bg-hover"}`}>{ROLE_LABEL[role]}</button>;
                    })}
                  </div>
                </div>
              ))}
            </fieldset>
            {owner ? (
              <p className="text-sm text-muted-foreground">An owner can use every part of LendHous. That access isn&apos;t limited.</p>
            ) : (
              <fieldset disabled={isSelf} className="space-y-4">
                <legend className="label">What they can do</legend>
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1 text-xs text-faint">{group.label}</p>
                    <ul className="divide-y divide-border rounded-[2px] border border-border">
                      {group.items.map((permission) => {
                        const on = draft.permissions.includes(permission);
                        return (
                          <li key={permission}>
                            <button type="button" role="switch" aria-checked={on} data-testid={`perm-${permission}`} onClick={() => togglePermission(permission)} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-hover">
                              <span className="min-w-0">{PERMISSIONS[permission]}{on !== defaults.includes(permission) && <small className="block text-xs text-warn">Changed from the role</small>}</span>
                              <span aria-hidden className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-faint"}`}><span className={`absolute top-0.5 size-4 rounded-full bg-background transition-all ${on ? "left-[18px]" : "left-0.5"}`} /></span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </fieldset>
            )}
          </div>
          <footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-popover p-4">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <SubmitButton className="h-10 px-5 text-[13.5px] font-medium" pendingLabel="Saving…">{editing ? "Save changes" : "Send invitation"}</SubmitButton>
          </footer>
        </form>
        {editing && (
          <form action={linkAction} className="border-t border-border p-5">
            <input type="hidden" name="id" value={draft.id} />
            <p className="text-sm text-muted-foreground">Forgot their password, or never got the invitation?</p>
            <SubmitButton variant="outline" className="mt-3 h-10 text-[13px] font-medium" pendingLabel="Sending…">Send a new password link</SubmitButton>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RemoveSheet({ row, onClose }: { row: MemberRow; onClose: () => void }) {
  const [state, action] = useActionState(deleteMember, {} as MemberFormState);
  useEffect(() => { if (state.saved) onClose(); }, [state.saved, onClose]);
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className={sheetClass}>
        <SheetHead eyebrow="Members" title={`Remove ${row.name}?`}>They can no longer sign in, and any open session ends now. Their records stay.</SheetHead>
        <form action={action} className="space-y-4 p-5" data-testid="remove-form">
          <input type="hidden" name="id" value={row.id} />
          {state.error && <p role="alert" className="rounded-[2px] border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{state.error}</p>}
          <dl className="text-sm"><dt className="text-muted-foreground">Email</dt><dd className="wrap-anywhere">{row.email}</dd><dt className="mt-2 text-muted-foreground">Role</dt><dd>{row.roles.map((role) => ROLE_LABEL[role]).join(", ")}</dd></dl>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <SubmitButton variant="default" className="h-10 bg-bad px-5 text-[13.5px] font-medium text-white hover:bg-bad/90" pendingLabel="Removing…">Remove member</SubmitButton>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function IssuedSheet({ issued, onClose }: { issued: NonNullable<MemberFormState["issued"]>; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(issued.link); setCopied(true); };
  const said = issued.mail === "sent" ? `We emailed the link to ${issued.email}. You can also share it yourself.` : issued.mail === "failed" ? `The email to ${issued.email} didn't send. Share this link with them yourself.` : `This address doesn't take mail on this server. Share this link with them yourself.`;
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className={sheetClass}>
        <SheetHead eyebrow="Ready to share" title={issued.invited ? `${issued.name} is invited` : `New link for ${issued.name}`}><span data-testid="issued-mail">{said}</span></SheetHead>
        <div className="space-y-4 p-5">
          <div><p className="label">One-time link, good for seven days</p><p className="rounded-[2px] border border-border bg-muted p-3 font-mono text-xs break-all" data-testid="issued-link">{issued.link}</p></div>
          <p className="text-xs text-muted-foreground">Anyone with this link can set the password on this account, so send it only to them.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Done</button>
            <button type="button" className="btn-primary" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
