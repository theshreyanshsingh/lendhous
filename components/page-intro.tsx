export function PageIntro({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <header className="mb-7 max-w-3xl">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-2.5 text-[32px] leading-[1.06] font-normal text-foreground sm:text-[40px]">{title}</h1>
      {lede && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{lede}</p>}
    </header>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <div className="mt-2">{children}</div>
      {hint && <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{hint}</span>}
    </label>
  );
}
