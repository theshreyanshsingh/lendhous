"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

// The quote is its own page, and a payoff request isn't a new loan.
const HIDDEN = ["/start", "/payoff"];

/** On a phone, once the visitor scrolls past the first screen, the quote rides at the foot of every public page. */
export function SitePhoneCta() {
  const path = usePathname();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const check = () => setShown(window.scrollY > 480);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, [path]);
  if (HIDDEN.some((prefix) => path.startsWith(prefix))) return null;
  return (
    <>
      <div className="phone-cta-space" aria-hidden="true" />
      <div className={`phone-cta${shown ? " on" : ""}`} data-testid="phone-cta" aria-hidden={!shown}>
        <Link className="button" href="/start" tabIndex={shown ? undefined : -1}>See your terms <ArrowRight size={18} aria-hidden="true" /></Link>
        <span>Indicative terms on the spot. No credit check.</span>
      </div>
    </>
  );
}
