"use client";

/**
 * A dollar field that reads like money: 250,000 rather than 250000. It takes typed or pasted digits (commas, a dollar
 * sign and spaces are dropped) and hands back a number, or NaN when it's empty.
 */
export function AmountInput({ value, onChange, ...rest }: { value: number; onChange: (next: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const shown = Number.isNaN(value) ? "" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      onChange={(event) => {
        const raw = event.target.value.replace(/[^0-9.]/g, "");
        // A trailing point is kept while typing cents.
        onChange(raw === "" ? NaN : Number(raw.endsWith(".") ? raw.slice(0, -1) : raw));
      }}
    />
  );
}
