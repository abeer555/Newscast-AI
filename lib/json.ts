/**
 * Parsing text that came out of the database.
 *
 * Every JSON column in this schema is written by code, but "written by code" is not
 * the same as "always well-formed": a truncated write, a hand-edited row, or a schema
 * change mid-flight all produce text that JSON.parse rejects. An uncaught parse turns
 * one bad row into a 500 on a whole page, which is a poor trade — the honest response
 * to an unreadable column is to treat it as absent and keep rendering the rest.
 *
 * Nothing here touches the database, so this module is safe to import anywhere,
 * including from client components.
 */

/** Parses `raw` as JSON, returning `fallback` if it is missing or malformed. */
export function safeParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  const s = raw.trim();
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Parses a JSON array column, returning [] for anything that is not an array. */
export function safeArray<T>(raw: unknown): T[] {
  const v = safeParse<unknown>(raw, null);
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Reads a column that holds either a JSON array of ids or a single bare id.
 * `contradicted_by` has been written both ways across schema versions.
 */
export function idList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith("[")) return safeArray<unknown>(s).map(String).filter(Boolean);
  return [s];
}
