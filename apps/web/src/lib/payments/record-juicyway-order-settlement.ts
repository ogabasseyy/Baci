import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { calculateJuicywayPlatformFee } from '@/lib/payments/juicyway-platform-fee';
import { resolveOrderGiglSettlementRpc } from '@/lib/payments/resolve-order-gigl-settlement-rpc';

type JuicywaySettlementTransaction = {
  amount: number | string | null;
  merchant_id: string;
  order_id: string | null;
  platform_fee: number | string | null;
};

/**
 * Idempotent merchant settlement for a captured Juicyway order payment.
 * Locked to a service-role client — Juicyway calls anonymously; trust is the
 * webhook signature check in the route.
 */
export async function recordJuicywayOrderSettlement(
  supabase: SupabaseClient,
  transaction: JuicywaySettlementTransaction,
  reference: string
): Promise<boolean> {
  try {
    const grossAmount = Number(transaction.amount);
    if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
      throw new Error('Invalid Juicyway settlement gross amount');
    }
    const gatewayFee = 0;
    const platformFee =
      transaction.platform_fee == null
        ? calculateJuicywayPlatformFee(grossAmount)
        : Number(transaction.platform_fee);
    if (!Number.isFinite(platformFee) || platformFee < 0) {
      throw new Error('Invalid Juicyway settlement platform fee');
    }

    let orderEconomics = null;
    if (transaction.order_id) {
      const { data: order, error: orderLoadError } = await supabase
        .from('orders')
        .select(
          'shipping_provider, shipping_funding_source, shipping_platform_retained_amount'
        )
        .eq('id', transaction.order_id)
        .maybeSingle();
      if (orderLoadError) {
        logger.warn({
          message:
            'Failed to load order economics for Juicyway settlement recording',
          error: orderLoadError,
          orderId: transaction.order_id,
          reference,
        });
        return false;
      }
      orderEconomics = order;
    }
    const settlement = resolveOrderGiglSettlementRpc(orderEconomics);
    const { error: settlementError } = await supabase.rpc(
      settlement.settlementRpc,
      {
        p_merchant_id: transaction.merchant_id,
        p_source_type: 'order',
        p_source_id: transaction.order_id,
        p_gateway: 'juicyway',
        p_gateway_reference: reference,
        p_gross_amount: grossAmount,
        p_gateway_fee: gatewayFee,
        p_platform_fee: platformFee,
        p_description: 'Order payment via Juicyway',
        p_metadata: {
          juicyway_reference: reference,
          ...(settlement.hasEconomicsSnapshot
            ? {
                commerce_platform_fee: platformFee,
                retained_shipping_amount: settlement.retainedShippingAmount,
              }
            : {}),
        },
      }
    );

    if (settlementError) {
      logger.warn({
        message: 'Failed to record merchant settlement',
        error: settlementError,
        reference,
      });
      return false;
    }
    logger.info({
      message: 'Merchant settlement recorded (Juicyway)',
      reference,
      grossAmount,
    });
    return true;
  } catch (settlementError) {
    logger.warn({
      message: 'Settlement recording error',
      error: settlementError,
    });
    return false;
  }
}
