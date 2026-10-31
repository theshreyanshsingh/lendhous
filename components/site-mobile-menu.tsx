"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

/** The public site's phone menu. CSS hides it above 700px, where the header shows these links itself. */
export function SiteMobileMenu() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <button type="button" className="menu-toggle" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} data-testid="site-menu" onClick={() => setOpen(!open)}>
        {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
      </button>
      <div className="mobile-menu" data-open={open}>
        <Link href="/programs">Loan programs</Link>
        <Link href="/about">About</Link>
        <Link href="/resources">Resources</Link>
        <Link href="/calculators">Calculators</Link>
        <Link href="/login" data-testid="mobile-portal-login">Portal login</Link>
      </div>
    </>
  );
}
