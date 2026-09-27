import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

// REDVAULT-scoped counterpart to fileInventoryConfirmationFailureReview: the
// user-facing verify flow files serialized_inventory_confirmation_failed
// reviews through the narrowly scoped file_uba_redvault_inventory_review RPC
// (service_role or the merchant-bound storefront route client) instead of
// inserting through the unrestricted admin client.
export async function fileRedvaultInventoryConfirmationReview({
  gatewayReference,
  merchantId,
  metadata,
  orderId,
  reason,
  supabase,
  transactionId,
}: {
  gatewayReference: string | null;
  merchantId: string;
  metadata?: Record<string, unknown>;
  orderId: string;
  reason: string;
  supabase: Pick<SupabaseClient, 'rpc'>;
  transactionId: string | null;
}): Promise<void> {
  logger.warn({
    gatewayReference,
    message:
      'Paid-order inventory confirmation failed; filing reconciliation review',
    orderId,
    transactionId,
  });

  // Filing reconciliation review rows is best-effort: payment flows must not
  // throw after funds were captured solely because the ops queue insert failed.
  try {
    const { data, error } = await supabase.rpc(
      'file_uba_redvault_inventory_confirmation_review',
      {
        p_gateway_reference: gatewayReference,
        p_merchant_id: merchantId,
        p_metadata: metadata ?? {},
        p_order_id: orderId,
        p_reason: reason,
        p_transaction_id: transactionId,
      }
    );

    if (error) {
      logger.error({
        error,
        gatewayReference,
        message: 'Failed to file serialized inventory reconciliation review',
        orderId,
        transactionId,
      });
      return;
    }

    if (
      data &&
      typeof data === 'object' &&
      (data as { duplicate?: unknown }).duplicate === true
    ) {
      logger.info({
        gatewayReference,
        message:
          'serialized_inventory_confirmation_failed reconciliation already filed (expected retry no-op)',
        orderId,
        transactionId,
      });
    }
  } catch (error) {
    logger.error({
      error,
      gatewayReference,
      message:
        'Failed to file serialized inventory reconciliation review (threw)',
      orderId,
      transactionId,
    });
  }
}
