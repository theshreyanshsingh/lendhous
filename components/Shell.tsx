"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ClipboardList, FilePlus, Inbox, Landmark, LayoutDashboard, BookOpen, Lock, LogOut, Menu, RotateCcw, type LucideIcon } from "lucide-react";
import { logout } from "@/actions/auth";
import { useStore } from "@/lib/store";
import type { View } from "@/lib/permissions";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; section?: string };

// Layout follows UPB Capital's AppShell: fixed left sidebar on desktop, a sheet on mobile. The signed-in
// account's role picks the workspace; there is no switching between them.
const nav: Record<View, NavItem[]> = {
  borrower: [{ href: "/admin/borrower", label: "My loans", icon: LayoutDashboard }, { href: "/admin/apply", label: "New application", icon: FilePlus }],
  admin: [{ href: "/admin", label: "Pipeline", icon: ClipboardList }, { href: "/admin/leads", label: "Website leads", icon: Inbox }, { href: "/admin/capital", label: "Capital", icon: Landmark, section: "Money" }],
  partner: [{ href: "/admin/partner", label: "Deal feed", icon: BookOpen }],
};
const home: Record<View, string> = { borrower: "/admin/borrower", admin: "/admin", partner: "/admin/partner" };

function active(path: string, href: string) {
  if (href === "/admin") return path === "/admin" || path.startsWith("/admin/deals");
  return path === href || path.startsWith(`${href}/`);
}

export type ShellAccount = { name: string; email: string; roles: string[]; demo: boolean };

export default function Shell({ children, account, view }: { children: React.ReactNode; account: ShellAccount; view: View | null }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const items: NavItem[] = [...(view ? nav[view] : []), { href: "/admin/account/security", label: "Security", icon: Lock, section: "Account" }];
  const logoHref = view ? home[view] : "/admin/account/security";
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-sidebar-border bg-sidebar px-3 pt-3.5 pb-3 md:flex">
        <div className="px-2 pt-2 pb-5"><Logo href={logoHref} /></div>
        <SideNav items={items} path={path} />
        <Controls account={account} />
      </aside>
      <div className="md:pl-72">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-rule bg-background px-4 py-3 md:hidden">
          <Logo href={logoHref} />
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
        <main id="desk" className="mx-auto min-w-0 max-w-7xl px-4 pt-5 pb-10 md:px-[22px] md:pt-7 md:pb-12">{children}</main>
      </div>
    </div>
  );
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

/** Theme, sign-out and the signed-in account, docked where UPB shows them. Demo seats can also reset the demo book. */
function Controls({ account }: { account: ShellAccount }) {
  const { dispatch } = useStore();
  return (
    <div className="shrink-0 space-y-2 border-t border-sidebar-border pt-3">
      <div>
        <ThemeToggle />
        {account.demo && (
          <button type="button" onClick={() => dispatch({ t: "reset" })} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-hover">
            <RotateCcw className="size-[15px] text-muted-foreground" /> Reset demo data
          </button>
        )}
        <form action={logout}>
          <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-hover">
            <LogOut className="size-[15px] text-muted-foreground" /> Sign out
          </button>
        </form>
      </div>
      <div className="flex items-center gap-2 rounded-[2px] p-2" data-testid="signed-in-as">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{account.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[13px]">{account.name}</strong>
          <em className="block truncate text-xs not-italic text-muted-foreground">{account.roles.join(" · ")}</em>
        </span>
        {account.demo && <span className="shrink-0 rounded-[2px] border border-rule px-1.5 py-0.5 text-[9.5px] font-medium tracking-[0.14em] text-eyebrow" data-testid="demo-account">DEMO</span>}
      </div>
    </div>
  );
}
