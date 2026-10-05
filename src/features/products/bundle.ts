/** Build a bundle display name like "A+B+C - Elite" from components + tier. */
export function buildBundleName(componentNames: string[], tier: string): string {
  const names = componentNames.map((n) => n.trim()).filter(Boolean).join('+')
  const t = tier.trim()
  if (!names) return t
  return t ? `${names} - ${t}` : names
}
