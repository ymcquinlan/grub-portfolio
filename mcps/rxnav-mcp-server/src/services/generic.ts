/**
 * Best-effort helpers for RxNav endpoints whose JSON wrapper key names are
 * thinly documented (mostly the small reference/metadata lists — idtypes,
 * termtypes, propnames, relatypes, etc). RxNav nests every list one level
 * deep in a singular wrapper object (e.g. `{ idTypeList: { idName: [...] } }`),
 * so rather than hard-code every wrapper name (and risk it being wrong), we
 * walk down through single-key objects until we hit an array.
 */

/** Descend through nested single-key objects to find the first array of values. */
export function extractFirstArray(data: unknown): unknown[] {
  let current: unknown = data;
  for (let depth = 0; depth < 5; depth++) {
    if (Array.isArray(current)) return current;
    if (current && typeof current === "object") {
      const values = Object.values(current as Record<string, unknown>);
      if (values.length === 0) return [];
      const arrayValue = values.find((v) => Array.isArray(v));
      if (arrayValue) return arrayValue as unknown[];
      if (values.length === 1) {
        current = values[0];
        continue;
      }
      return [];
    }
    return [];
  }
  return [];
}

/** Coerce a list of primitives/strings into plain strings for display. */
export function asStringList(items: unknown[]): string[] {
  return items.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
}
