import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateProducts } from '@/lib/cache-revalidation';
import { logger } from '@/lib/logger';
import { scheduleOrderBlogPurgeForOrderAfterResponse } from '@/lib/schedule-order-blog-purge-for-order-after-response';

export class SerializedInventoryUnavailableError extends Error {
  constructor() {
    super('serialized_inventory_unavailable');
    this.name = 'SerializedInventoryUnavailableError';
  }
}

export function isSerializedInventoryUnavailableError(
  error: unknown
): error is SerializedInventoryUnavailableError {
  return error instanceof SerializedInventoryUnavailableError;
}

function withCause(message: string, cause: unknown) {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

/**
 * Ensures that inventory reservations for a paid or BNPL-approved order are confirmed.
 * Invokes the `confirm_order_inventory_reservations` database function.
 * If any strict serialized items could not be confirmed (e.g., they expired and were taken),
 * throws a retryable error so payment reconciliation can retry.
 */
export async function ensurePaidOrderInventoryConfirmed(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string
): Promise<void> {
  const { data, error } = await supabase.rpc(
    'confirm_order_inventory_reservations',
    {
      p_merchant_id: merchantId,
      p_order_id: orderId,
    }
  );

  if (error) {
    throw withCause('Inventory confirmation failed', error);
  }

  const result = data as {
    alreadyConfirmed?: number;
    confirmedUnitCount?: number;
    reclaimedUnitCount?: number;
    missingUnitCount?: number;
    exceptionCodes?: Array<{ itemId: string; code: string }>;
  } | null;

  // The RPC only rewrites product/variant stock (via sync_serialized_stock) when
  // it RE-CLAIMS a fresh serialized unit because the original reservation expired
  // (reclaimedUnitCount > 0). Every other outcome — already-confirmed,
  // confirm-in-place, or inventory_tracking_policy='off' — leaves stock unchanged.
  // Gate on that single case so paid-order webhooks don't churn feed/dashboard/
  // category tags on every hit. The re-claim already COMMITTED with the RPC, so
  // revalidate even if the exceptionCodes throw below fires for a different item.
  if ((result?.reclaimedUnitCount ?? 0) > 0) {
    try {
      revalidateProducts(merchantId);
    } catch (revalidateError) {
      logger.error({
        error: revalidateError,
        message:
          'Failed to revalidate product caches after inventory confirmation',
        merchantId,
        orderId,
      });
    }
    scheduleOrderBlogPurgeForOrderAfterResponse({
      supabase,
      merchantId,
      orderId,
    });
  }

  if (
    result?.exceptionCodes &&
    Array.isArray(result.exceptionCodes) &&
    result.exceptionCodes.length > 0
  ) {
    throw new SerializedInventoryUnavailableError();
  }
}

export interface OrderStatusRollbackSnapshot {
  payment_status: string | null;
  shipping_status: string | null;
  // Optional: webhooks that set amount_paid alongside payment_status must
  // restore it too, or a retried payout validates against a zero residual.
  amount_paid?: number | string | null;
}

export async function rollbackOrderStatusAfterInventoryConfirmationFailure(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  previousStatus: OrderStatusRollbackSnapshot
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({
      payment_status: previousStatus.payment_status,
      shipping_status: previousStatus.shipping_status,
      ...(previousStatus.amount_paid !== undefined && {
        amount_paid: previousStatus.amount_paid,
      }),
    })
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .select('id')
    .single();

  if (error) {
    throw new Error(
      `rollback_order_status_after_inventory_confirmation_failure failed: ${error.message}`
    );
  }
}
