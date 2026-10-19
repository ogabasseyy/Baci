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
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  extractMetadataField,
  isMetadataRecord,
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

export const VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY =
  'voucherPinBackfillScheduledAt';
export const VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY = 'voucherPinBackfillAttempts';
// After a no-pin result, clear the timestamp; the persisted
// last-attempt marker then paces the next attempt (successful rows
// only — see vtu-backfill-pacing). Stop retrying successful no-pin
// rows after this many Kuda BILL_TSQ calls.
export const MAX_VOUCHER_PIN_BACKFILL_ATTEMPTS = 10;
// Short dedupe window: only block a second concurrent attempt within the same
// request burst. Clearing the timestamp lifts this check, but successful rows
// stay paced by the attempt interval until the next attempt is due.
export const TOKEN_BACKFILL_DEDUPE_WINDOW_MS = 5_000;

function toStableJsonValue(value: unknown): unknown {
  if (typeof value === 'undefined') {
    throw new TypeError(
      'Cannot stable JSON stringify metadata containing undefined'
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }

  if (isMetadataRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = toStableJsonValue(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

/**
 * Serializes metadata for PostgREST JSON equality filters with deterministic
 * object key order. Undefined is rejected because JSON.stringify would either
 * omit it or convert it to null, which can corrupt compare-and-set semantics.
 */
export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value)) ?? 'null';
}

function getBackfillAttempts(metadata: MetadataRecord): number {
  const raw = metadata[VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export function hasRecentBackfillSchedule(metadata: MetadataRecord): boolean {
  // Hard stop: exhausted all retry attempts.
  if (getBackfillAttempts(metadata) >= MAX_VOUCHER_PIN_BACKFILL_ATTEMPTS) {
    return true;
  }

  const scheduledAt = extractMetadataField(
    metadata,
    VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY,
    isString
  );
  const scheduledAtMs = scheduledAt ? Date.parse(scheduledAt) : Number.NaN;
  if (
    Number.isFinite(scheduledAtMs) &&
    Date.now() - scheduledAtMs < TOKEN_BACKFILL_DEDUPE_WINDOW_MS
  ) {
    return true;
  }
  // Pacing: 3s client polls would burn the 10-lookup budget in ~30s
  // of a ~6min window. Only successful schedules write the marker,
  // so processing rows are unaffected.
  return isBackfillAttemptPaced(metadata);
}

export async function markVoucherPinBackfillScheduled({
  consumeAttempt,
  metadata,
  originalMetadata,
  supabase,
  transactionId,
}: {
  consumeAttempt: boolean;
  metadata: MetadataRecord;
  originalMetadata: unknown;
  supabase: SupabaseClient;
  transactionId: string;
}): Promise<MetadataRecord | null> {
  const nowIso = new Date().toISOString();
  const nextMetadata: MetadataRecord = {
    ...metadata,
    [VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]: nowIso,
  };
  if (consumeAttempt) {
    nextMetadata[VOUCHER_PIN_BACKFILL_ATTEMPTS_KEY] =
      getBackfillAttempts(metadata) + 1;
    // Persisted pacing marker (never cleared): spreads the 10-lookup
    // budget across the client poll window.
    nextMetadata[VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY] = nowIso;
  }
  let updateQuery = supabase
    .from('vtu_transactions')
    .update({ metadata: nextMetadata })
    .eq('id', transactionId);

  updateQuery =
    originalMetadata === null
      ? updateQuery.is('metadata', null)
      : updateQuery.filter(
          'metadata',
          'eq',
          // Supabase filter() expects raw PostgREST syntax, so pass stable JSON
          // text instead of an object, which would become "[object Object]".
          stableJsonStringify(originalMetadata)
        );

  const { data, error } = await updateQuery.select('id');
  if (error) {
    console.error('Failed to mark VTU voucher-pin backfill as scheduled:', {
      error,
      transactionId,
    });
    return null;
  }

  return Array.isArray(data) && data.length > 0 ? nextMetadata : null;
}

/**
 * After a no-pin result from Kuda, clear voucherPinBackfillScheduledAt using
 * compare-and-set so concurrent metadata writes (e.g. webhooks) are not
 * clobbered. Clearing lifts the 5s dedupe check; the persisted
 * last-attempt marker still paces successful rows to one attempt per
 * interval (up to the attempt cap).
 */
export async function clearVoucherPinBackfillTimestamp({
  currentMetadata,
  supabase,
  transactionId,
}: {
  currentMetadata: MetadataRecord;
  supabase: SupabaseClient;
  transactionId: string;
}): Promise<void> {
  const { [VOUCHER_PIN_BACKFILL_SCHEDULED_AT_KEY]: _dropped, ...rest } =
    currentMetadata;
  const { error } = await supabase
    .from('vtu_transactions')
    .update({ metadata: rest })
    .eq('id', transactionId)
    .filter('metadata', 'eq', stableJsonStringify(currentMetadata));

  if (error) {
    console.error(
      'Failed to clear VTU voucher-pin backfill timestamp after no-pin result:',
      { error, transactionId }
    );
  }
}
