/** Serializes inventory evidence with recursively sorted object keys. */
export function canonicalizeStorefrontEdgeInventoryValue(
  value: unknown
): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalizeStorefrontEdgeInventoryValue).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalizeStorefrontEdgeInventoryValue(item)}`
      )
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error('inventory value is not JSON serializable');
  return serialized;
}
