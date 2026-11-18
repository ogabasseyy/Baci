/** Finds the first update payload whose metadata matches the predicate. */
export function findPayloadWithMetadata(
  payloads: unknown[],
  predicate: (metadata: Record<string, unknown>) => boolean
): { metadata: Record<string, unknown> } | undefined {
  return payloads.find(
    (payload): payload is { metadata: Record<string, unknown> } => {
      if (typeof payload !== 'object' || payload === null) {
        return false;
      }
      const metadata = (payload as { metadata?: unknown }).metadata;
      return (
        typeof metadata === 'object' &&
        metadata !== null &&
        predicate(metadata as Record<string, unknown>)
      );
    }
  );
}
