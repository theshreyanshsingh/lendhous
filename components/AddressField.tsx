"use client";
import { AnimatePresence, motion } from "framer-motion";
import { MapPin } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AddressValue, FoundAddress, Suggestion } from "@/lib/places";

export type { AddressValue };
export const emptyAddress = (): AddressValue => ({ street: "", city: "", state: "", zip: "", county: "" });

// Off for the rest of the visit once the server says there's no key, so typing doesn't keep asking.
let lookupOff = false;

/**
 * A street address with Google's suggestions as you type, when the server has a key. Picking one fills the city, state,
 * ZIP and county. The parts stay editable, so an address Google doesn't know can still be typed in full.
 */
export function AddressField({ value, onChange, label = "Property address", variant = "panel", testid = "address", required = true, county = true }: { value: AddressValue; onChange: (next: AddressValue) => void; label?: string; variant?: "panel" | "site"; testid?: string; required?: boolean; county?: boolean }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const session = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const look = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (lookupOff || text.trim().length < 4) { setSuggestions([]); return; }
    if (!session.current) session.current = crypto.randomUUID();
    timer.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/places?kind=suggest&q=${encodeURIComponent(text)}&session=${session.current}`);
        const body = (await response.json()) as { suggestions?: Suggestion[]; enabled?: boolean };
        if (body.enabled === false) { lookupOff = true; return; }
        setSuggestions(body.suggestions ?? []);
        setOpen(true);
        setActive(-1);
      } catch {
        setSuggestions([]);
      }
    }, 250);
  };
  const pick = async (item: Suggestion) => {
    setOpen(false);
    setSuggestions([]);
    try {
      const response = await fetch(`/api/places?kind=details&id=${encodeURIComponent(item.id)}&session=${session.current}`);
      const body = (await response.json()) as { address?: FoundAddress };
      if (body.address) onChange({ street: body.address.street || item.main, city: body.address.city, state: body.address.state, zip: body.address.zip, county: body.address.county });
    } catch {
      onChange({ ...value, street: item.main });
    }
    session.current = "";
  };
  const keys = (event: React.KeyboardEvent) => {
    if (!open || !suggestions.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((at) => Math.min(suggestions.length - 1, at + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActive((at) => Math.max(0, at - 1)); }
    if (event.key === "Enter" && active >= 0) { event.preventDefault(); void pick(suggestions[active]); }
    if (event.key === "Escape") setOpen(false);
  };

  const site = variant === "site";
  const input = site ? "" : "desk-input";
  const part = (key: keyof AddressValue, text: string, extra: { max?: number; auto?: string } = {}) => (
    <label className={site ? "" : "block min-w-0"}>{site ? text : <span className="label">{text}</span>}
      <input className={input} data-testid={`${testid}-${key}`} required={required && key !== "county"} maxLength={extra.max ?? 100} autoComplete={extra.auto} value={value[key]} onChange={(event) => onChange({ ...value, [key]: key === "state" ? event.target.value.toUpperCase().slice(0, 2) : event.target.value })} />
    </label>
  );
  return (
    <div className={site ? "address-field" : "space-y-3"} data-testid={testid}>
      <div className="relative">
        <label className={site ? "" : "block"}>{site ? label : <span className="label">{label}</span>}
          <input className={input} data-testid={`${testid}-street`} role="combobox" aria-expanded={open && suggestions.length > 0} aria-controls={listId} aria-autocomplete="list" required={required} maxLength={200} autoComplete="street-address" placeholder="Start typing the street address"
            value={value.street} onKeyDown={keys} onBlur={() => setTimeout(() => setOpen(false), 150)} onFocus={() => suggestions.length && setOpen(true)}
            onChange={(event) => { onChange({ ...value, street: event.target.value }); look(event.target.value); }} />
        </label>
        <AnimatePresence>
          {open && suggestions.length > 0 && (
            <motion.ul id={listId} role="listbox" data-testid={`${testid}-suggestions`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}
              className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-[2px] border border-border bg-card text-left text-sm shadow-[var(--shadow)]">
              {suggestions.map((item, index) => (
                <li key={item.id} role="option" aria-selected={index === active}>
                  <button type="button" className={`flex w-full items-start gap-2 px-3 py-2 text-left ${index === active ? "bg-active" : "hover:bg-hover"}`} onMouseDown={(event) => event.preventDefault()} onClick={() => void pick(item)}>
                    <MapPin size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0"><b className="font-medium">{item.main}</b> <span className="text-muted-foreground">{item.secondary}</span></span>
                  </button>
                </li>
              ))}
              <li className="px-3 py-1 text-right text-[11px] text-muted-foreground">powered by Google</li>
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
      <div className={site ? "fields" : `grid grid-cols-2 gap-3 ${county ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        {part("city", "City", { auto: "address-level2" })}
        {part("state", "State", { max: 2, auto: "address-level1" })}
        {part("zip", "ZIP", { max: 10, auto: "postal-code" })}
        {county && part("county", "County (if you know it)")}
      </div>
    </div>
  );
}
