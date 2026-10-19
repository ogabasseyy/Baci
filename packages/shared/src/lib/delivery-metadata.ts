/** Format persisted delivery metadata for human-readable order views. */
export function formatDeliveryMetadataLabel(
  value: string | null | undefined
): string | null {
  if (!value) return null;

  return value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}
