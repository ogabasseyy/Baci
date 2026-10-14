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

/**
 * Fixed customer-safe failure message. Provider error text (Kuda /
 * Monnify response bodies, which may contain identifiers) must never
 * reach API responses — it is persisted raw server-side for support
 * correlation and replaced with this fixed string at every return
 * site (Codex R89 P1).
 */
export const VTU_CUSTOMER_FAILURE_MESSAGE =
  'Utility purchase failed. Please try again.';

/**
 * Provenance flag for persisted failure text: present-and-true only
 * when error_message was authored first-party (fixed strings like
 * the wallet-race notice), never provider text. Replay resolution
 * returns error_message verbatim only with this flag and otherwise
 * falls back to VTU_CUSTOMER_FAILURE_MESSAGE — fail closed, since
 * pre-flag rows are overwhelmingly provider-authored.
 */
export const VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY = 'customerSafeErrorMessage';

/**
 * Crash window for a VTU customer-email claim: the claim RPC sets
 * `<attemptedKey>` + `<attemptedKey>At` (ISO UTC) atomically, but a
 * crash between the claim and the send/clear leaves Attempted=true
 * forever — every later claim refuses and the R86 reconciler arm
 * (Sent `eq.false`) never matches the unset sent key, so the email
 * is never retried. Claims older than this lease (or stamped rows
 * missing the timestamp, i.e. pre-lease stuck rows) are reclaimable
 * by the RPC, the TS pre-check, and the reconciler's stuck-claim arm
 * (Codex R89 P2). 15 minutes mirrors the baseline shipment-booking
 * lock timeout and dwarfs send latency (one ZeptoMail call), so a
 * live sender always holds a fresh lease while a crashed one frees
 * the row on the next cron tick. The claim RPC hardcodes the same
 * 15-minute interval — keep both in sync.
 */
export const CUSTOMER_EMAIL_NOTIFICATION_CLAIM_LEASE_MS = 15 * 60 * 1000;

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
