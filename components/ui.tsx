"use client";
import React from "react";
import type { Color, Grade } from "@/lib/engine";

export const usd = (n: number, d = 0) => (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (x: number, d = 1) => (x * 100).toFixed(d) + "%";
export const k = (n: number) => (Math.abs(n) >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : "$" + Math.round(n / 1000).toLocaleString() + "k");

// good / warn / bad are UPB's status tokens; tints match its StatusPill
const colorCls: Record<Color, string> = {
  green: "bg-good/10 text-good ring-good/25",
  yellow: "bg-warn/12 text-warn ring-warn/25",
  red: "bg-bad/10 text-bad ring-bad/25",
};
const dot: Record<Color, string> = { green: "bg-good", yellow: "bg-warn", red: "bg-bad" };
export function RatioPill({ label, value, limit, color, kind = "max", isMultiple }: { label: string; value: number; limit: number; color: Color; kind?: "max" | "min"; isMultiple?: boolean }) {
  const f = (v: number) => (isMultiple ? v.toFixed(2) + "x" : pct(v));
  return (
    <div className={`rounded-lg px-3 py-2 ring-1 ${colorCls[color]}`} data-testid={`ratio-${label}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold"><span className={`size-2 rounded-full ${dot[color]}`} />{label}</div>
      <div className="text-lg font-semibold leading-tight tracking-tight">{f(value)}</div>
      <div className="text-[11px] opacity-80">{kind === "max" ? "max" : "min"} {f(limit)}</div>
    </div>
  );
}
export function ColorDot({ color }: { color: Color }) { return <span className={`inline-block size-2.5 rounded-full ${dot[color]}`} />; }
const gradeCls: Record<Grade, string> = { A: "bg-good/10 text-good", B: "bg-good/10 text-good", C: "bg-warn/12 text-warn", D: "bg-bad/10 text-bad", E: "bg-bad/10 text-bad" };
export function GradeBadge({ grade, score }: { grade: Grade; score?: number }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[2px] px-2 py-0.5 text-xs font-semibold ${gradeCls[grade]}`}>{grade}{score !== undefined && <span className="font-medium opacity-80">· {score}</span>}</span>;
}
export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "rose" | "violet" }) {
  const t = { slate: "bg-muted text-muted-foreground", blue: "bg-link/10 text-link", green: "bg-good/10 text-good", amber: "bg-warn/12 text-warn", rose: "bg-bad/10 text-bad", violet: "bg-foreground/[0.07] text-foreground" }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-[2px] px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}
export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-0.5 text-base font-semibold tracking-tight wrap-anywhere text-foreground tabular-nums">{value}</div>{sub && <div className="text-xs text-muted-foreground">{sub}</div>}</div>;
}
export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return <section className="glass min-w-0 p-4 sm:p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="eyebrow">{title}</h2>{right}</div>{children}</section>;
}
/** The sizes a row of headline numbers uses everywhere: two across on a phone, more once there is room. */
export const statGrid = "grid grid-cols-2 gap-3 sm:grid-cols-4";
/** Ratio pills are wide for their content, so three across waits for a bigger screen. */
export const ratioGrid = (count: number) => `grid gap-2 ${count > 2 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`;
export const statusLabel = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const productLabel: Record<string, string> = { fix_flip: "Fix & Flip", bridge: "Bridge", ground_up: "Ground-Up", dscr: "DSCR Rental" };
export const capTone = (c: string) => (c === "funded" || c === "committed" ? "green" : c === "reserved" ? "blue" : c === "bids_in" ? "violet" : c === "teaser_out" ? "amber" : "slate") as "green";
