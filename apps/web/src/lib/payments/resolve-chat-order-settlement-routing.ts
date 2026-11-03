import {
  PAYSTACK_SETTLEMENT_COLLECTION_UNKNOWN,
  resolveSettlementRpcRouting,
  type SettlementRpcRouting,
} from '@/lib/payments/resolve-settlement-rpc-routing';

/**
 * Picks the settlement recorder for a chat order paid through the webhook.
 * Chat-order DVAs are Baci-owned (no subaccount), so their verified payload
 * normally proves Baci collected the money and the credit stays spendable.
 * A payload that proves nothing keeps the previous wallet credit without the
 * Baci-collected marker: the payout guard then treats it as not spendable
 * until reconciled, which is the safe direction for money Baci may not hold.
 */
export function resolveChatOrderSettlementRouting(args: {
  gateway: string;
  gatewayResponse: unknown;
}): SettlementRpcRouting {
  const fallback: SettlementRpcRouting = {
    extraMetadata: {},
    extraParams: {},
    rpc: 'record_merchant_settlement',
  };
  if (args.gateway !== 'paystack') {
    return fallback;
  }
  try {
    return resolveSettlementRpcRouting({
      gatewayResponse: args.gatewayResponse,
      isRedvaultDirectSettlement: false,
      settlementGateway: 'paystack',
      useGiglSettlementRpc: false,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === PAYSTACK_SETTLEMENT_COLLECTION_UNKNOWN
    ) {
      return fallback;
    }
    throw error;
  }
}
