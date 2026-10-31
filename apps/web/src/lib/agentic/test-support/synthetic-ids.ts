/**
 * Deterministic UUID-shaped ids. The checkout catalog only queries ids that
 * match the Postgres UUID pattern, so synthetic ids must look like UUIDs.
 */
export function syntheticUuid(namespace: number, index: number): string {
  const hex = (value: number, width: number) =>
    value.toString(16).padStart(width, '0');
  return `${hex(namespace, 8)}-0000-4000-8000-${hex(index, 12)}`;
}
