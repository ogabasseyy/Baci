import { after } from 'next/server';
import type { createAdminClient } from '@/lib/supabase/admin';
import {
  clearVoucherPinBackfillTimestamp,
  hasRecentBackfillSchedule,
  markVoucherPinBackfillScheduled,
  stableJsonStringify,
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
interface VoucherPinBackfillTransaction {
  error_message?: unknown;
  id: unknown;
  request_reference: unknown;
  status: unknown;
  transaction_id: unknown;
  type: unknown;
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

export async function scheduleVoucherPinBackfill({
  deferPoll = true,
  metadata,
  originalMetadata,
  supabase,
  transaction,
  voucherPin,
}: {
  /**
   * False = run the provider poll inline instead of registering a
   * second after(). For callers that already run inside their own
   * after() (history GET), so the schedule stays a single layer
   * (Muse R151 M1). Webhook/confirm keep the default.
   */
  deferPoll?: boolean;
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

  // Named poll step (Muse R151 M1): identical body whether it runs
  // inline (caller-owned after) or deferred (own after below).
  const pollVoucherPinBackfill = async (): Promise<void> => {
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
  };

  if (!deferPoll) {
    await pollVoucherPinBackfill();
    return true;
  }

  after(async () => {
    await pollVoucherPinBackfill();
  });

  return true;
}
