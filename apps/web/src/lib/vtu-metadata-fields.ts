/**
 * Pure VTU metadata field helpers.
 *
 * Leaf module (zero imports) split out of vtu-voucher-backfill: the
 * history transaction projection needs extractMetadataField/isString
 * but must not drag the backfill module's fulfillment/admin import
 * graph into the production-surface closure (event-pipeline boundary
 * contract). vtu-voucher-backfill re-exports these so existing
 * route/test importers are untouched.
 */

export type MetadataRecord = Record<string, unknown>;

export function isMetadataRecord(
  metadata: unknown
): metadata is MetadataRecord {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata)
  );
}

export function normalizeMetadata(metadata: unknown): MetadataRecord {
  return isMetadataRecord(metadata) ? metadata : {};
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function extractMetadataField<T>(
  metadata: unknown,
  key: string,
  validator: (value: unknown) => value is T
): T | null {
  if (!isMetadataRecord(metadata)) {
    return null;
  }

  const value = metadata[key];
  return validator(value) ? value : null;
}
