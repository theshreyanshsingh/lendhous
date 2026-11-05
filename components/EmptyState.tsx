import { EmptyArt } from "@/components/art/HouseArt";

/** An empty list: a small house drawing and one or two plain sentences, the same everywhere. */
export function EmptyState({ children, testid }: { children: React.ReactNode; testid?: string }) {
  return (
    <div className="glass flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground" data-testid={testid}>
      <EmptyArt className="h-20 w-28" />
      <div className="max-w-md">{children}</div>
    </div>
  );
}
