export function q(sp: Record<string, string | string[] | undefined>, key: string) {
  const value = sp[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
