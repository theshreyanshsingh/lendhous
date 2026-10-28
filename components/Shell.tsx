"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, ClipboardList, FilePlus, Landmark, LayoutDashboard, LayoutGrid, Lock, LogIn, LogOut, Menu, RotateCcw, type LucideIcon } from "lucide-react";
import { logout } from "@/actions/auth";
import { useStore, type Role } from "@/lib/store";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; section?: string };

// Layout follows UPB Capital's AppShell: fixed left sidebar on desktop, a sheet on mobile.
const nav: Record<Role, NavItem[]> = {
  borrower: [{ href: "/borrower", label: "My loans", icon: LayoutDashboard }, { href: "/apply", label: "New application", icon: FilePlus }],
  admin: [{ href: "/admin", label: "Pipeline", icon: ClipboardList }, { href: "/admin/capital", label: "Capital", icon: Landmark, section: "Money" }],
  partner: [{ href: "/partner", label: "Deal feed", icon: BookOpen }],
};
const home: Record<Role, string> = { borrower: "/borrower", admin: "/admin", partner: "/partner" };
const roleLabel: Record<Role, string> = { borrower: "Borrower", admin: "Admin / Underwriter", partner: "Partner lender" };

function active(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/admin") return path === "/admin" || path.startsWith("/admin/deals");
  return path === href || path.startsWith(`${href}/`);
}

export type ShellAccount = { name: string; email: string; roles: string[] } | null;

export default function Shell({ children, account }: { children: React.ReactNode; account: ShellAccount }) {
  const { s, dispatch } = useStore();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // The URL decides the role. Re-check after every store update, not only role changes: the localStorage hydrate
  // runs after this effect in the same batch, and when it restores the role the store started with, s.role looks
  // unchanged and a [path, s.role] effect would never run again.
  useEffect(() => {
    const r: Role | null = path.startsWith("/apply") || path.startsWith("/borrower") ? "borrower" : path.startsWith("/admin") ? "admin" : path.startsWith("/partner") ? "partner" : null;
    if (r && r !== s.role) dispatch({ t: "role", role: r });
  }, [path, s]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setOpen(false), [path]);
  const items: NavItem[] = [
    ...nav[s.role],
    ...(account ? [{ href: "/account/security", label: "Security", icon: Lock, section: "Account" }] : []),
    { href: "/", label: "All prototype views", icon: LayoutGrid, section: "Prototype" },
  ];
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-sidebar-border bg-sidebar px-3 pt-3.5 pb-3 md:flex">
        <div className="flex items-center gap-2.5 px-2 pt-2 pb-5"><Logo href={home[s.role]} /><Tag /></div>
        <SideNav items={items} path={path} />
        <Controls testid account={account} />
      </aside>
      <div className="md:pl-72">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-rule bg-background px-4 py-3 md:hidden">
          <div className="flex items-center gap-2.5"><Logo href={home[s.role]} /><Tag /></div>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger className="inline-flex size-9 items-center justify-center rounded-[2px] border border-rule bg-background" aria-label="Open navigation">
              <Menu className="size-4" />
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col bg-sidebar px-3 pt-10 pb-3">
              <SideNav items={items} path={path} />
              <Controls account={account} />
            </SheetContent>
          </Sheet>
        </div>
        <div className="border-b border-warn/20 bg-warn/10 px-4 py-1.5 text-center text-[10.5px] font-medium tracking-[0.06em] text-warn">CLICKABLE PROTOTYPE · all people, companies, addresses and numbers are FAKE · rates are PLACEHOLDERS · estimates are not commitments to lend</div>
        <main id="desk" className="mx-auto min-w-0 max-w-7xl px-4 pt-5 pb-8 md:px-[22px] md:pt-[18px] md:pb-7">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-faint md:px-[22px]">LendHous prototype · pricing from <code>lib/pricing-config.ts</code> (placeholders) · engine per Spec v3 §5</footer>
      </div>
    </div>
  );
}

function Tag() {
  return <span className="rounded-[2px] border border-rule px-1.5 py-0.5 text-[9.5px] font-medium tracking-[0.14em] text-eyebrow">PROTOTYPE</span>;
}

function SideNav({ items, path }: { items: NavItem[]; path: string }) {
  const sections: { label: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const label = item.section ?? "";
    const found = sections.find((section) => section.label === label);
    if (found) found.items.push(item);
    else sections.push({ label, items: [item] });
  }
  return (
    <nav className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {sections.map((section) => (
        <div key={section.label || "main"} className={section.label ? "mt-4" : ""}>
          {section.label && <p className="px-2.5 pt-1 pb-1.5 text-[10.5px] font-medium tracking-[0.14em] text-eyebrow uppercase">{section.label}</p>}
          {section.items.map((item) => {
            const on = active(path, item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={cn("mb-0.5 flex min-h-9 items-center gap-2.5 rounded-[2px] px-2.5 text-[13.5px] transition-colors", on ? "bg-active font-medium text-foreground shadow-[inset_2px_0_0_var(--primary)]" : "text-nav hover:bg-hover")}>
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Prototype-only seat switcher, docked where UPB shows the signed-in account. */
function Controls({ testid, account }: { testid?: boolean; account: ShellAccount }) {
  const { s, dispatch } = useStore();
  const router = useRouter();
  return (
    <div className="shrink-0 space-y-2 border-t border-sidebar-border pt-3">
      <label className="block px-1">
        <span className="text-xs text-faint">View as</span>
        <select data-testid={testid ? "role-switcher" : undefined} className="desk-input mt-1 h-9" value={s.role} onChange={(e) => router.push(home[e.target.value as Role])}>
          {(Object.keys(roleLabel) as Role[]).map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
        </select>
      </label>
      {s.role === "partner" && (
        <label className="block px-1">
          <span className="text-xs text-faint">Partner organization</span>
          <select className="desk-input mt-1 h-9" value={s.partnerId} onChange={(e) => dispatch({ t: "partner", id: e.target.value })}>
            {s.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      <div>
        <ThemeToggle />
        <button type="button" onClick={() => { localStorage.clear(); dispatch({ t: "reset" }); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-hover">
          <RotateCcw className="size-[15px] text-muted-foreground" /> Reset demo data
        </button>
        {account ? (
          <form action={logout}>
            <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-hover">
              <LogOut className="size-[15px] text-muted-foreground" /> Sign out
            </button>
          </form>
        ) : (
          <Link href="/login" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-hover">
            <LogIn className="size-[15px] text-muted-foreground" /> Sign in
          </Link>
        )}
      </div>
      {account && (
        <div className="flex items-center gap-2 rounded-[2px] p-2" data-testid="signed-in-as">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{account.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-[13px]">{account.name}</strong>
            <em className="block truncate text-xs not-italic text-muted-foreground">{account.roles.join(" · ")}</em>
          </span>
        </div>
      )}
    </div>
  );
}
