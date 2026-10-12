/**
 * Pacing for successful-row voucher-pin provider lookups.
 *
 * Split out of vtu-voucher-backfill.ts per the Boy Scout Rule (that
 * module is over the 300-line budget). The client polls history every
 * 3s (then 10s) for ~6 minutes, and every poll can schedule a Kuda
 * BILL_TSQ lookup — without pacing, the 10-lookup budget burns in
 * ~30s and a token that becomes queryable later never surfaces.
 * Spreading 10 attempts ~30s apart covers ~5 minutes while keeping
 * the provider-call ceiling.
 *
 * Only successful schedules write the marker (processing rows re-drive
 * fulfillment on the 5s dedupe window instead), so a processing →
 * successful flip still triggers its first token lookup immediately.
 */
import {
  extractMetadataField,
  isString,
  type MetadataRecord,
} from '@/lib/vtu-metadata-fields';

/** Persisted — never cleared (unlike the scheduled-at timestamp). */
export const VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY =
  'voucherPinBackfillLastAttemptAt';
export const VOUCHER_PIN_BACKFILL_ATTEMPT_INTERVAL_MS = 30_000;

export function isBackfillAttemptPaced(
  metadata: MetadataRecord,
  nowMs: number = Date.now()
): boolean {
  const lastAttemptAt = extractMetadataField(
    metadata,
    VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY,
    isString
  );
  const lastAttemptMs = lastAttemptAt ? Date.parse(lastAttemptAt) : Number.NaN;
  // Absent/unparseable markers never pace (fail open here: the
  // attempt cap and dedupe window still bound total lookups).
  return (
    Number.isFinite(lastAttemptMs) &&
    nowMs - lastAttemptMs < VOUCHER_PIN_BACKFILL_ATTEMPT_INTERVAL_MS
  );
}
