import { after } from 'next/server';
import type { createAdminClient } from '@/lib/supabase/admin';
import {
  isBackfillAttemptPaced,
  VOUCHER_PIN_BACKFILL_LAST_ATTEMPT_AT_KEY,
} from '@/lib/vtu-backfill-pacing';
import {
  backfillVtuVoucherPin,
  fulfillPendingVtuTransaction,
} from '@/lib/vtu-fulfillment';
import {
  extractMetadataField,
  isMetadataRecord,
  isString,
  type MetadataRecord,
  normalizeMetadata,
} from '@/lib/vtu-metadata-fields';

export {
  extractMetadataField,
  isMetadataRecord,
  isString,
  type MetadataRecord,
  normalizeMetadata,
};

export const TOKEN_BACKFILL_TYPES = new Set([
  'electricity',
  'cable_tv',
  'betting',
]);
export const MAX_TOKEN_BACKFILL_SCHEDULES = 3;
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

interface VoucherPinBackfillTransaction {
  error_message?: unknown;
  id: unknown;
  request_reference: unknown;
  status: unknown;
  transaction_id: unknown;
  type: unknown;
}

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
function stableJsonStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value)) ?? 'null';
}

export function shouldBackfillForType(type: unknown): boolean {
  return TOKEN_BACKFILL_TYPES.has(String(type));
}

export function shouldBackfillForStatus(status: unknown): boolean {
  return status === 'successful' || status === 'processing';
}

/**
 * True for processing rows with neither provider reference nor
 * response (mirrors the reconciliation-claim precondition). Such
 * rows can never resolve a pin through fulfill, and scheduling
 * them would bump updated_at (postponing pre-vend recovery) while
 * consuming backfill budget ahead of eligible rows — so candidate
 * builders must filter them BEFORE the budget, and the scheduler
 * re-checks defensively (Codex R42 rm5ao, R43 rnTRj).
 */
export function isReferenceLessProcessingTransaction(
  transaction: Pick<
    VoucherPinBackfillTransaction,
    'error_message' | 'status' | 'transaction_id'
  >
): boolean {
  if (transaction.status !== 'processing') {
    return false;
  }
  const providerReference = isString(transaction.transaction_id)
    ? transaction.transaction_id.trim()
    : '';
  const providerResponse = isString(transaction.error_message)
    ? transaction.error_message.trim()
    : '';
  return providerReference === '' && providerResponse === '';
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

async function markVoucherPinBackfillScheduled({
  consumeAttempt,
  metadata,
  originalMetadata,
  supabase,
  transactionId,
}: {
  consumeAttempt: boolean;
  metadata: MetadataRecord;
  originalMetadata: unknown;
  supabase: ReturnType<typeof createAdminClient>;
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
async function clearVoucherPinBackfillTimestamp({
  currentMetadata,
  supabase,
  transactionId,
}: {
  currentMetadata: MetadataRecord;
  supabase: ReturnType<typeof createAdminClient>;
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

export async function scheduleVoucherPinBackfill({
  metadata,
  originalMetadata,
  supabase,
  transaction,
  voucherPin,
}: {
  metadata: MetadataRecord;
  originalMetadata: unknown;
  supabase: ReturnType<typeof createAdminClient>;
  transaction: VoucherPinBackfillTransaction;
  voucherPin: string | null;
}): Promise<boolean> {
  if (
    voucherPin !== null ||
    !shouldBackfillForStatus(transaction.status) ||
    !shouldBackfillForType(transaction.type) ||
    hasRecentBackfillSchedule(metadata) ||
    // Reference-less processing rows can never resolve a pin — and
    // every schedule/clear cycle bumps updated_at, postponing the
    // 5-minute pre-vend staleness gate indefinitely while history
    // polling continues (Codex R42 rm5ao). Successful rows still
    // backfill (their Kuda lookup keys on the request reference).
    // Candidate builders pre-filter this before any budget (R43
    // rnTRj); this re-check defends direct callers.
    isReferenceLessProcessingTransaction(transaction)
  ) {
    return false;
  }

  if (!isString(transaction.id)) {
    console.error('Cannot schedule VTU voucher-pin backfill without an id:', {
      transaction,
    });
    return false;
  }

  const transactionId = transaction.id;
  const scheduledMetadata = await markVoucherPinBackfillScheduled({
    consumeAttempt: transaction.status === 'successful',
    metadata,
    originalMetadata,
    supabase,
    transactionId,
  });

  if (!scheduledMetadata) {
    return false;
  }

  after(async () => {
    const currentMetadata = scheduledMetadata;
    let pinResolved = false;

    try {
      const currentPin = extractMetadataField(
        currentMetadata,
        'voucherPin',
        isString
      );

      if (currentPin || transaction.status === 'failed') {
        console.log('VTU voucher-pin backfill resolved before provider poll', {
          status: transaction.status,
          transactionId,
        });
        pinResolved = Boolean(currentPin);
      } else if (transaction.status === 'processing') {
        const result = await fulfillPendingVtuTransaction({
          supabase,
          transactionId,
        });
        pinResolved =
          result.status === 'successful' && Boolean(result.voucherPin);
      } else if (transaction.status === 'successful') {
        const { voucherPin, units } = await backfillVtuVoucherPin({
          billRequestRef: isString(transaction.request_reference)
            ? transaction.request_reference
            : null,
          billResponseReference: isString(transaction.transaction_id)
            ? transaction.transaction_id
            : null,
          metadata: currentMetadata,
          supabase,
          transactionId,
        });

        pinResolved = Boolean(voucherPin);
        // backfill persists the pin via RPC but returns units for the owner of
        // the metadata write to persist; this path has no later write, so do it.
        // Re-fetch the latest metadata and persist units with a compare-and-set
        // (matching clearVoucherPinBackfillTimestamp) so a concurrent
        // webhook/wallet/notification write between our read and write is never
        // clobbered: if metadata changed, the filter matches 0 rows and we skip
        // (the next history poll retries).
        if (voucherPin && units) {
          const { data: latest, error: readError } = await supabase
            .from('vtu_transactions')
            .select('metadata')
            .eq('id', transactionId)
            .single();
          if (readError) {
            console.error('Failed to read metadata before units persist:', {
              error: readError.message,
              transactionId,
            });
          } else {
            const latestMetadata = normalizeMetadata(latest?.metadata);
            if (latestMetadata.units !== units) {
              const { data: updatedRows, error: unitsError } = await supabase
                .from('vtu_transactions')
                .update({
                  metadata: { ...latestMetadata, units },
                })
                .eq('id', transactionId)
                .filter('metadata', 'eq', stableJsonStringify(latestMetadata))
                .select('id');
              if (unitsError) {
                console.error('Failed to persist VTU units on backfill:', {
                  error: unitsError.message,
                  transactionId,
                });
              } else if (!updatedRows || updatedRows.length === 0) {
                // CAS lost the race (another writer changed metadata). The pin
                // is already persisted so history won't reschedule — log so the
                // dropped units are observable rather than silent.
                console.warn(
                  'VTU units CAS update matched 0 rows (lost race):',
                  {
                    transactionId,
                  }
                );
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('VTU voucher-pin backfill provider poll failed:', {
        error,
        transactionId,
      });
    }

    if (!pinResolved) {
      try {
        await clearVoucherPinBackfillTimestamp({
          currentMetadata,
          supabase,
          transactionId,
        });
      } catch (clearError) {
        console.error(
          'VTU backfill loop: failed to clear backfill timestamp:',
          clearError
        );
      }
    }
  });

  return true;
}
