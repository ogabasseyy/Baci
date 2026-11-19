import { createHash } from 'node:crypto';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)])
    );
  return value;
}
export function experienceCatalogRevision(
  generation: string,
  value: unknown
): string {
  return createHash('sha256')
    .update(JSON.stringify([generation, stable(value)]))
    .digest('hex');
}
/** No grace for stale price/availability; caller selects the existing engine fallback. */
export async function readConsistentCatalog<T>(deps: {
  generation: () => Promise<string | null>;
  read: () => Promise<T>;
}): Promise<{ data: T; generation: string; revision: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await deps.generation();
    if (before === null) return null;
    const data = await deps.read();
    const after = await deps.generation();
    if (before === after)
      return {
        data,
        generation: before,
        revision: experienceCatalogRevision(before, data),
      };
  }
  return null;
}
