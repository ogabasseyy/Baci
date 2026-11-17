import type { SupabaseClient } from '@supabase/supabase-js';

const RECOVERY_CONCURRENCY_LIMIT = 5;

export interface MerchantReservationRecoverySummary {
  cancelledAbandonedCount: number;
  failedMerchants: string[];
  preservedScheduledCount: number;
  reconciledPublishedCount: number;
}

export async function recoverMerchantBlogReleaseReservations(
  supabase: SupabaseClient,
  merchantIds: string[]
): Promise<MerchantReservationRecoverySummary | null> {
  if (
    merchantIds.length === 0 ||
    typeof (supabase as { rpc?: unknown }).rpc !== 'function'
  ) {
    return null;
  }

  let cancelledAbandonedCount = 0;
  let reconciledPublishedCount = 0;
  let preservedScheduledCount = 0;
  const failedMerchants: string[] = [];

  for (let i = 0; i < merchantIds.length; i += RECOVERY_CONCURRENCY_LIMIT) {
    const batch = merchantIds.slice(i, i + RECOVERY_CONCURRENCY_LIMIT);
    const results = await Promise.allSettled(
      batch.map(async (merchantId) => ({
        merchantId,
        result: await supabase.rpc(
          'recover_abandoned_blog_release_reservations_v1',
          {
            p_merchant_id: merchantId,
          }
        ),
      }))
    );

    for (let index = 0; index < results.length; index++) {
      const settled = results[index];
      const merchantId = batch[index];
      if (settled.status === 'rejected') {
        console.error(
          'Cron Warning: Failed to recover abandoned blog release reservations:',
          { merchantId, error: settled.reason }
        );
        failedMerchants.push(merchantId);
        continue;
      }

      const { data, error } = settled.value.result;
      if (error || !data || typeof data !== 'object') {
        console.error(
          'Cron Warning: Failed to recover abandoned blog release reservations:',
          { merchantId, error }
        );
        failedMerchants.push(merchantId);
        continue;
      }

      const record = data as Record<string, unknown>;
      if (typeof record.cancelled_abandoned_count === 'number') {
        cancelledAbandonedCount += record.cancelled_abandoned_count;
      }
      if (typeof record.reconciled_published_count === 'number') {
        reconciledPublishedCount += record.reconciled_published_count;
      }
      if (typeof record.preserved_scheduled_count === 'number') {
        preservedScheduledCount += record.preserved_scheduled_count;
      }
    }
  }

  return {
    cancelledAbandonedCount,
    failedMerchants,
    preservedScheduledCount,
    reconciledPublishedCount,
  };
}
