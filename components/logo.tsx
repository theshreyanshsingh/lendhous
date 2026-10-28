import Link from "next/link";

/** The LendHous wordmark: the name in the display serif with a sage full stop, as on the marketing site. */
export function Logo({ compact = false, href = "/" }: { compact?: boolean; href?: string }) {
  return (
    <Link href={href} aria-label="LendHous home" className="inline-flex items-baseline font-heading text-[23px] leading-none font-medium tracking-[-0.035em] text-foreground">
      {compact ? "L" : "LendHous"}
      <span className="text-brand">.</span>
    </Link>
  );
}
