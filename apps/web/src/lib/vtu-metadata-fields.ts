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

/**
 * Allowlisted metadata snapshot for logs and error contexts.
 * Everything else (pins, holder names) is dropped or redacted —
 * raw metadata must never reach logs.
 */
export function getSafeMetadataDiagnostics(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const safeKeys = [
    'customerNewBalance',
    'customerWalletCredited',
    'dataPlanCode',
    'gateway',
    'merchantWalletCredited',
    'paymentPending',
    'paymentReference',
  ] as const;
  const diagnostics: Record<string, unknown> = {};

  for (const key of safeKeys) {
    if (key in metadata) {
      diagnostics[key] = metadata[key];
    }
  }

  if ('voucherPin' in metadata) {
    diagnostics.voucherPin = '[REDACTED]';
  }
  if ('customerName' in metadata) {
    diagnostics.customerName = '[REDACTED]';
  }

  return diagnostics;
}
