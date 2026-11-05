"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BarChart3, Bell, Briefcase, ChevronDown, ChevronsUpDown, FileCheck, FileText, TriangleAlert, Percent, Building2, ClipboardList, FilePlus, Hammer, Inbox, Landmark, LayoutDashboard, ListChecks, BookOpen, Lock, LogOut, Menu, MessageSquare, ReceiptText, RotateCcw, ScrollText, Settings, Store, Tag, Upload, UserRound, Users, type LucideIcon } from "lucide-react";
import { logout } from "@/actions/auth";
import { attentionCounts } from "@/lib/attention";
import { useStore } from "@/lib/store";
import { VIEW_HOME, type View } from "@/lib/permissions";
import { Logo } from "@/components/logo";
import { StaffSearch } from "@/components/StaffSearch";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; section?: string; count?: number };
/** The owners' tools: folded away until opened, so the menu fits a laptop's screen. */
const ADMIN = "Admin";
const FOLDED_KEY = "lendhous-nav-folded";

// Layout follows UPB Capital's AppShell: fixed left sidebar on desktop, a sheet on mobile. The signed-in
// account's role picks the workspace; there is no switching between them.
const nav: Record<View, NavItem[]> = {
  borrower: [{ href: "/admin/borrower", label: "My loans", icon: LayoutDashboard }, { href: "/admin/apply", label: "Apply for a loan", icon: FilePlus }],
  admin: [{ href: "/admin", label: "Pipeline", icon: ClipboardList }, { href: "/admin/leads", label: "Website leads", icon: Inbox }, { href: "/admin/capital", label: "Capital", icon: Landmark, section: "Money" }, { href: "/admin/loan-sales", label: "Loan sales", icon: Tag, section: "Money" }, { href: "/admin/draws", label: "Draws", icon: Hammer, section: "Servicing" }, { href: "/admin/servicing", label: "Loan servicing", icon: ReceiptText, section: "Servicing" }],
  partner: [{ href: "/admin/partner", label: "Deal feed", icon: BookOpen }, { href: "/admin/partner/portfolio", label: "My portfolio", icon: Briefcase }],
  buyer: [{ href: "/admin/buyer", label: "Loans for sale", icon: Store }, { href: "/admin/buyer/portfolio", label: "My loans & offers", icon: Briefcase }],
  broker: [{ href: "/admin/broker", label: "My deals", icon: LayoutDashboard }, { href: "/admin/broker/new", label: "Submit a deal", icon: FilePlus }],
};

function active(path: string, href: string) {
  if (href === "/admin") return path === "/admin" || path.startsWith("/admin/deals");
  if (href === "/admin/buyer") return path === href || path.startsWith("/admin/buyer/loans");
  if (href === "/admin/broker") return path === href || path.startsWith("/admin/broker/deals");
  return path === href || path.startsWith(`${href}/`);
}

export type ShellAccount = { name: string; email: string; roles: string[]; demo: boolean; canManageMembers: boolean; canViewAudit: boolean; canManageSettings: boolean; canManageFirms: boolean; canManagePricing: boolean; canViewReports: boolean; canIssueLetters: boolean; canManageBrokers?: boolean; staleJobs: string[]; openErrors: number; unread: number; offerSample: boolean };

export default function Shell({ children, account, view }: { children: React.ReactNode; account: ShellAccount; view: View | null }) {
  const path = usePathname();
  const { s, newLeads, error, clearError } = useStore();
  const [open, setOpen] = useState(false);
  const waiting = attentionCounts(s, newLeads);
  useEffect(() => setOpen(false), [path]);
  const counted: Record<string, number> = view === "admin" ? { "/admin/leads": waiting.leads, "/admin/draws": waiting.draws, "/admin/loan-sales": waiting.offers, "/admin/servicing": waiting.servicing } : {};
  const items: NavItem[] = [
    ...(view ? nav[view] : []).map((item) => ({ ...item, count: counted[item.href] })),
    ...(account.canViewReports && view === "admin" ? [{ href: "/admin/reports", label: "Reports", icon: BarChart3 }] : []),
    ...(account.canIssueLetters && view === "admin" ? [{ href: "/admin/letters", label: "Letters", icon: FileCheck }] : []),
    ...(account.canManageFirms ? [{ href: "/admin/partners", label: "Partners & buyers", icon: Building2, section: "Money" }] : []),
    ...(account.canManageBrokers && view === "admin" ? [{ href: "/admin/brokers", label: "Brokers", icon: Briefcase, section: "Money", count: s.brokers.filter((broker) => broker.status === "applied").length || undefined }] : []),
    ...(account.canManagePricing && view === "admin" ? [{ href: "/admin/pricing", label: "Pricing", icon: Percent, section: "Money" }] : []),
    { href: "/admin/account/notifications", label: "Notifications", icon: Bell, section: "Account", count: account.unread },
    ...(account.canManageMembers ? [{ href: "/admin/members", label: "Members", icon: Users, section: ADMIN }] : []),
    ...(account.canViewAudit ? [{ href: "/admin/audit", label: "Audit log", icon: ScrollText, section: ADMIN }] : []),
    ...(account.canManageSettings ? [{ href: "/admin/conditions", label: "Conditions library", icon: ListChecks, section: ADMIN }, { href: "/admin/settings", label: "Settings", icon: Settings, section: ADMIN }, { href: "/admin/errors", label: "Errors", icon: TriangleAlert, section: ADMIN, count: account.openErrors }, { href: "/admin/tax", label: "Tax forms", icon: FileText, section: ADMIN }] : []),
    ...(view === "partner" || view === "buyer" || view === "broker" ? [{ href: "/admin/account/tax", label: "Tax form", icon: FileText, section: "Account" }] : []),
  ];
  const logoHref = view ? VIEW_HOME[view] : "/admin/account/security";
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-sidebar-border bg-sidebar px-3 pt-3.5 pb-3 lg:flex">
        <div className="px-2 pt-2 pb-4"><Logo href={logoHref} /></div>
        {view === "admin" && <StaffSearch />}
        <SideNav items={items} path={path} />
        <Controls account={account} />
      </aside>
      <div className="lg:pl-72">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-rule bg-background px-4 py-3 lg:hidden">
          <Logo href={logoHref} />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger className={cn("size-9 items-center justify-center rounded-[2px] border border-rule bg-background", view === "borrower" && !path.startsWith("/admin/apply") ? "hidden md:inline-flex" : "inline-flex")} aria-label="Open navigation">
              <Menu className="size-4" />
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col bg-sidebar px-3 pt-10 pb-3">
              {view === "admin" && <StaffSearch />}
              <SideNav items={items} path={path} />
              <Controls account={account} />
            </SheetContent>
          </Sheet>
        </div>
        <main id="desk" className={cn("mx-auto min-w-0 max-w-7xl px-4 pt-5 md:px-[22px] md:pt-7 md:pb-12", view === "borrower" ? "pb-28" : "pb-10")}>{account.staleJobs.length > 0 && <div role="alert" className="mb-4 rounded-[2px] border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad" data-testid="stale-jobs">The nightly {account.staleJobs.join(" and the ")} {account.staleJobs.length === 1 ? "hasn't" : "haven't"} run in over two days. Check that the jobs process is running on the server (<code>pm2 ls</code> shows <code>lendhous-jobs</code>), or run <code>npm run jobs</code>.</div>}{error && <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-[2px] border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad" data-testid="book-error"><span className="min-w-0">{error}</span><button type="button" className="shrink-0 underline" onClick={clearError}>Dismiss</button></div>}<SampleDataBar path={path} demo={account.demo} offer={account.offerSample} />{children}</main>
      </div>
      {/* While applying, Back and Next own the bottom of the screen. */}
      {view === "borrower" && !path.startsWith("/admin/apply") && <BorrowerTabs path={path} onAccount={() => setOpen(true)} />}
    </div>
  );
}

/**
 * A borrower's phone: the four things they come for, under their thumb. Upload and Messages go to the loan they're on,
 * or else the loan that needs something from them.
 */
function BorrowerTabs({ path, onAccount }: { path: string; onAccount: () => void }) {
  const { s } = useStore();
  const mine = s.deals.filter((deal) => deal.borrowerId === s.borrowerId);
  const here = mine.find((deal) => path.startsWith(`/admin/borrower/${deal.id}`));
  const owes = mine.find((deal) => deal.docs.some((doc) => doc.status === "requested" || doc.status === "rejected"));
  const loan = here ?? owes ?? mine[0];
  const tab = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]";
  const tabs = [
    { key: "loans", label: "My loans", icon: LayoutDashboard, href: "/admin/borrower", on: path === "/admin/borrower" },
    { key: "upload", label: "Upload", icon: Upload, href: loan ? `/admin/borrower/${loan.id}#needs-from-you` : "/admin/apply", on: false },
    { key: "messages", label: "Messages", icon: MessageSquare, href: loan ? `/admin/borrower/${loan.id}#messages` : "/admin/borrower", on: false },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-rule bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Borrower" data-testid="borrower-tabs">
      {tabs.map((item) => { const Icon = item.icon; return <Link key={item.key} href={item.href} className={cn(tab, item.on ? "font-medium text-foreground" : "text-muted-foreground")} data-testid={`tab-bar-${item.key}`}><Icon className="size-5" aria-hidden="true" />{item.label}</Link>; })}
      <button type="button" className={cn(tab, "text-muted-foreground")} onClick={onAccount} data-testid="tab-bar-account"><UserRound className="size-5" aria-hidden="true" />Account</button>
    </nav>
  );
}

/** Real accounts start empty. This offers them the same fake book the demo seats use, on the pages that show it. */
function SampleDataBar({ path, demo, offer }: { path: string; demo: boolean; offer: boolean }) {
  const { s, dispatch } = useStore();
  const realRecords = ["/admin/account", "/admin/members", "/admin/leads", "/admin/audit", "/admin/settings", "/admin/new-loan", "/admin/apply", "/admin/broker/new"].some((prefix) => path.startsWith(prefix));
  if (demo || realRecords) return null;
  if (!s.sample && (s.deals.length > 0 || !offer)) return null;
  return (
    <div className="glass mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm" data-testid="sample-data-bar">
      <p className="min-w-0 flex-1 basis-60 text-muted-foreground">{s.sample ? "You are viewing FAKE sample data. It stays in this browser and nobody else can see it." : "Nothing here yet. Load sample data to see how this works. It is FAKE, stays in this browser and clears with one click."}</p>
      {s.sample ? (
        <button type="button" className="btn-ghost" data-testid="clear-sample" onClick={() => dispatch({ t: "clearSample" })}>Clear sample data</button>
      ) : (
        <button type="button" className="btn-primary" data-testid="load-sample" onClick={() => dispatch({ t: "loadSample" })}>Load sample data</button>
      )}
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
  // Which groups are folded, remembered per browser. Admin starts folded; a group with the open page never is.
  const [folded, setFolded] = useState<string[]>([ADMIN]);
  useEffect(() => { try { const saved = localStorage.getItem(FOLDED_KEY); if (saved) setFolded(JSON.parse(saved) as string[]); } catch {} }, []);
  const toggle = (label: string) => setFolded((now) => { const next = now.includes(label) ? now.filter((item) => item !== label) : [...now, label]; try { localStorage.setItem(FOLDED_KEY, JSON.stringify(next)); } catch {} return next; });
  // A soft fade at the bottom while there's more of the menu below.
  const list = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const nav = list.current;
    if (!nav) return;
    const check = () => setMore(nav.scrollHeight - nav.scrollTop - nav.clientHeight > 4);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(nav);
    nav.addEventListener("scroll", check, { passive: true });
    return () => { observer.disconnect(); nav.removeEventListener("scroll", check); };
  }, [folded, items.length]);
  return (
    <nav ref={list} className={cn("mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain", more && "[mask-image:linear-gradient(to_bottom,black_calc(100%-36px),transparent)]")} data-testid="side-nav" data-more={more ? "1" : undefined}>
      {sections.map((section) => {
        const open = !section.label || !folded.includes(section.label) || section.items.some((item) => active(path, item.href));
        const waiting = section.items.reduce((sum, item) => sum + (item.count ?? 0), 0);
        return (
          <div key={section.label || "main"} className={section.label ? "mt-2.5" : ""}>
            {section.label && (
              <button type="button" className="flex w-full items-center gap-1.5 rounded-[2px] px-2.5 pt-1 pb-1 text-left text-[10.5px] font-medium tracking-[0.14em] text-eyebrow uppercase hover:text-foreground" aria-expanded={open} data-testid={`nav-group-${section.label}`} onClick={() => toggle(section.label)}>
                <span className="flex-1">{section.label}</span>
                {!open && waiting > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] tracking-normal text-primary-foreground normal-case">{waiting}</span>}
                <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
              </button>
            )}
            {open && section.items.map((item) => {
              const on = active(path, item.href);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className={cn("mb-0.5 flex min-h-11 items-center gap-2.5 rounded-[2px] px-2.5 text-[13.5px] transition-colors lg:min-h-8", on ? "bg-active font-medium text-foreground shadow-[inset_2px_0_0_var(--primary)]" : "text-nav hover:bg-hover")}>
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.count ? <span className="shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground" data-testid="nav-count">{item.count}</span> : null}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

/** The signed-in account, docked where UPB shows it. Its menu holds the theme, sign-out and, on demo seats, the reset. */
function Controls({ account }: { account: ShellAccount }) {
  const { dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", escape); };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0 border-t border-sidebar-border pt-2">
      {open && (
        <div className="absolute inset-x-0 bottom-full mb-1 rounded-[2px] border border-border bg-popover p-1 shadow-[var(--shadow)]" data-testid="account-menu-items">
          <Link href="/admin/account/security" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-hover">
            <Lock className="size-[15px] text-muted-foreground" /> Password and security
          </Link>
          <ThemeToggle />
          {account.demo && (
            <button type="button" onClick={() => { setOpen(false); dispatch({ t: "reset" }); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-hover">
              <RotateCcw className="size-[15px] text-muted-foreground" /> Reset demo data
            </button>
          )}
          <form action={logout}>
            <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-hover">
              <LogOut className="size-[15px] text-muted-foreground" /> Sign out
            </button>
          </form>
        </div>
      )}
      <button type="button" className="flex w-full items-center gap-2 rounded-[2px] p-2 text-left hover:bg-hover" aria-expanded={open} aria-label={`Account menu for ${account.name}`} data-testid="account-menu" onClick={() => setOpen(!open)}>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground" aria-hidden="true">{account.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}</span>
        <span className="min-w-0 flex-1" data-testid="signed-in-as">
          <strong className="block truncate text-[13px]">{account.name}</strong>
          <em className="block truncate text-xs not-italic text-muted-foreground">{account.roles.join(" · ")}</em>
        </span>
        {account.demo && <span className="shrink-0 rounded-[2px] border border-rule px-1.5 py-0.5 text-[9.5px] font-medium tracking-[0.14em] text-eyebrow" data-testid="demo-account">DEMO</span>}
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </div>
  );
}
