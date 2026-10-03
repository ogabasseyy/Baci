export interface OutboxMergeGuard {
  metadataRaw: unknown;
  updatedAt: string | null;
}

/**
 * Canonical JSON for the sent-merge optimistic guard: object keys sorted
 * recursively, array order preserved. PostgREST casts `eq` operands to the
 * column type, so `jsonb = jsonb` already compares order-insensitively;
 * canonical bytes make the match independent of serialization order even
 * so, and keep the guard byte-stable across re-reads.
 */
export function canonicalizeOutboxMetadataForGuard(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeOutboxMetadataForGuard).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const body = entries
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${canonicalizeOutboxMetadataForGuard(entry)}`
      )
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
