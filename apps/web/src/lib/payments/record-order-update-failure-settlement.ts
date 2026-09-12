import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOrderGiglSettlementRpc } from '@/lib/payments/resolve-order-gigl-settlement-rpc';
import {
  extractVerifiedGatewayFeeNgn,
  type SupportedGateway,
} from '@/lib/payments/verified-gateway-fee';
import { calculatePlatformFee } from '@/lib/paystack';

export type OrderUpdateFailureSettlementResult =
  | { kind: 'recorded' }
  | { kind: 'economics_load_failed'; error: unknown }
  | { kind: 'settlement_failed'; error: unknown };

type RecordOrderUpdateFailureSettlementArgs = {
  gateway: SupportedGateway;
  gatewayResponse: unknown;
  merchantId: string;
  orderId: string | null;
  platformFee: number | null | undefined;
  reference: string;
  gatewayReference: string | null | undefined;
  grossAmount: number;
  supabase: SupabaseClient;
};

/**
 * Idempotent settlement fallback when gateway payment succeeded but the order
 * completion flip failed. Selects GIGL vs legacy settlement RPC from order
 * economics so retention metadata stays correct on redelivery.
 */
export async function recordOrderUpdateFailureSettlement(
  args: RecordOrderUpdateFailureSettlementArgs
): Promise<OrderUpdateFailureSettlementResult> {
  const gatewayFee = extractVerifiedGatewayFeeNgn(
    args.gateway,
    args.gatewayResponse
  );
  const platformFee =
    Number(args.platformFee) ||
    calculatePlatformFee(args.grossAmount * 100).platformFee / 100;

  let orderEconomics = null;
  if (args.orderId) {
    const { data: order, error: orderEconomicsLoadError } = await args.supabase
      .from('orders')
      .select(
        'shipping_provider, shipping_funding_source, shipping_platform_retained_amount'
      )
      .eq('id', args.orderId)
      .maybeSingle();

    if (orderEconomicsLoadError) {
      return {
        kind: 'economics_load_failed',
        error: orderEconomicsLoadError,
      };
    }
    orderEconomics = order;
  }

  const settlement = resolveOrderGiglSettlementRpc(orderEconomics);
  const { error: fallbackSettlementError } = await args.supabase.rpc(
    settlement.settlementRpc,
    {
      p_merchant_id: args.merchantId,
      p_source_type: 'order',
      p_source_id: args.orderId,
      p_gateway: args.gateway,
      p_gateway_reference: args.gatewayReference ?? args.reference,
      p_gross_amount: args.grossAmount,
      p_gateway_fee: gatewayFee,
      p_platform_fee: platformFee,
      p_description: `Order payment via ${args.gateway} (order update failed)`,
      p_metadata: {
        [`${args.gateway}_reference`]: args.reference,
        verified_gateway_fee: gatewayFee,
        order_update_failed: true,
        ...(settlement.hasEconomicsSnapshot
          ? {
              commerce_platform_fee: platformFee,
              retained_shipping_amount: settlement.retainedShippingAmount,
            }
          : {}),
      },
    }
  );

  if (fallbackSettlementError) {
    return { kind: 'settlement_failed', error: fallbackSettlementError };
  }

  return { kind: 'recorded' };
}
