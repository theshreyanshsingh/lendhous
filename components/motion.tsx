"use client";
// The app's motion: calm, short and vertical. Steps rise into place and settle; panels open and close by height. Nothing
// slides sideways, so nothing pokes past a phone's edge mid-move, and people who ask for less motion get a plain fade.
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Swaps one step for the next: the old one fades up and out, the new one rises in. Going back runs it the other way. */
export function StepSwap({ step, direction = 1, children, className }: { step: string | number; direction?: 1 | -1; children: ReactNode; className?: string }) {
  const still = useReducedMotion();
  const rise = still ? 0 : 14 * direction;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={step} className={className} initial={{ opacity: 0, y: rise }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -rise }} transition={{ duration: still ? 0.12 : 0.26, ease: EASE }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Opens and closes a panel by its height, for forms that appear under a button. */
export function Reveal({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const still = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div className={className} style={{ overflow: "hidden" }} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: still ? 0.1 : 0.24, ease: EASE }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Fades something in as it arrives, like a confirmation or an estimate. */
export function Arrive({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const still = useReducedMotion();
  return <motion.div className={className} initial={{ opacity: 0, y: still ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay, ease: EASE }}>{children}</motion.div>;
}
