import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** The way back to a list: a thumb-sized target on a phone, the same small line of text on a desk. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="-my-2.5 inline-flex min-h-11 max-w-full items-center gap-1.5 text-sm text-link hover:underline lg:my-0 lg:min-h-0" data-testid="back-link">
      <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </Link>
  );
}
