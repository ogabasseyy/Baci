import {
  resolveSettlementRpcRouting,
  type SettlementRpcRouting,
} from '@/lib/payments/resolve-settlement-rpc-routing';

/**
 * Picks the settlement recorder for a chat order paid through the webhook.
 * Chat-order DVAs are Baci-owned (no subaccount), so their verified payload
 * normally proves Baci collected the money and the credit stays spendable.
 * A payload that proves nothing throws paystack_settlement_collection_unknown,
 * like the main settlement path: it may be a split the merchant's bank
 * already received, so nothing is credited and the caller logs the error.
 */
export function resolveChatOrderSettlementRouting(args: {
  gateway: string;
  gatewayResponse: unknown;
}): SettlementRpcRouting {
  if (args.gateway !== 'paystack') {
    return {
      extraMetadata: {},
      extraParams: {},
      rpc: 'record_merchant_settlement',
    };
  }
  return resolveSettlementRpcRouting({
    gatewayResponse: args.gatewayResponse,
    isRedvaultDirectSettlement: false,
    settlementGateway: 'paystack',
    useGiglSettlementRpc: false,
  });
}
