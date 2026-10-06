// Resolve an entry from an exports node: plain strings, condition
// maps (in the caller's preference order), and fallback arrays, with
// bounded nesting for shapes like {node: {require: ...}}. Returns null
// when no preferred condition exists so the caller fails closed.
export function resolveExportTarget(
  node: unknown,
  conditions: readonly string[]
): string | null {
  const walk = (current: unknown, depth: number): string | null => {
    if (typeof current === 'string') {
      return current;
    }
    if (depth > 2 || current === null || typeof current !== 'object') {
      return null;
    }
    if (Array.isArray(current)) {
      for (const element of current) {
        const resolved = walk(element, depth + 1);
        if (resolved !== null) {
          return resolved;
        }
      }
      return null;
    }
    const map = current as Record<string, unknown>;
    for (const key of conditions) {
      if (key in map) {
        const resolved = walk(map[key], depth + 1);
        if (resolved !== null) {
          return resolved;
        }
      }
    }
    return null;
  };
  return walk(node, 0);
}
