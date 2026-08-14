/**
 * SQLite's CURRENT_TIMESTAMP writes "2026-08-14 10:29:18" — UTC, but with no
 * timezone marker, which `new Date()` then reads as *local* time and silently
 * shifts every displayed timestamp by your UTC offset. Normalise to a real
 * ISO instant before formatting anything.
 *
 * Kept out of the .tsx component so it can be unit tested directly: Node's
 * type stripping handles TypeScript but not JSX.
 */
export function toIso(value: string): string {
  if (!value) return new Date(0).toISOString();
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return new Date(value).toISOString();
  const sqlite = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value);
  if (sqlite) return new Date(`${sqlite[1]}T${sqlite[2]}Z`).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

/** The server-side rendering of an instant: unambiguous, locale-independent. */
export function utcLabel(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}
