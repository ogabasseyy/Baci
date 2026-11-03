import { classifyPaystackSettlementCollection } from '@/lib/payments/classify-paystack-settlement-collection';

export const PAYSTACK_SETTLEMENT_COLLECTION_UNKNOWN =
  'paystack_settlement_collection_unknown';

export type SettlementRpcRouting = {
  extraMetadata: Record<string, string | number>;
  extraParams: Record<string, string>;
  rpc: string;
};

export function resolveSettlementRpcRouting(args: {
  gatewayResponse: unknown;
  isRedvaultDirectSettlement: boolean;
  settlementGateway: 'juicyway' | 'korapay' | 'paystack';
  useGiglSettlementRpc: boolean;
}): SettlementRpcRouting {
  const { useGiglSettlementRpc } = args;
  // REDVAULT split sales pay the merchant share straight to the Paystack
  // subaccount; the direct variant records history with no wallet movement.
  // REDVAULT wins over every other Paystack classification.
  if (args.isRedvaultDirectSettlement) {
    return {
      extraMetadata: {},
      extraParams: {},
      rpc: useGiglSettlementRpc
        ? 'record_uba_redvault_direct_settlement_gigl_v1'
        : 'record_uba_redvault_direct_settlement',
    };
  }
  const walletRpc = useGiglSettlementRpc
    ? 'record_merchant_settlement_gigl_v1'
    : 'record_merchant_settlement';
  if (args.settlementGateway !== 'paystack') {
    return { extraMetadata: {}, extraParams: {}, rpc: walletRpc };
  }

  // Fail closed: never credit the Baci wallet without proof of where the
  // money went.
  const collection = classifyPaystackSettlementCollection(args.gatewayResponse);
  if (collection.mode === 'unknown') {
    throw new Error(PAYSTACK_SETTLEMENT_COLLECTION_UNKNOWN);
  }
  if (collection.mode === 'integration') {
    return {
      extraMetadata: { paystack_collection: 'integration' },
      extraParams: {},
      rpc: walletRpc,
    };
  }
  return {
    extraMetadata: {
      paystack_collection: 'direct_split',
      paystack_subaccount_code: collection.subaccountCode,
      ...(collection.subaccountShareKobo === null
        ? {}
        : { paystack_subaccount_share_kobo: collection.subaccountShareKobo }),
      ...(collection.integrationShareKobo === null
        ? {}
        : { paystack_integration_share_kobo: collection.integrationShareKobo }),
      ...(collection.transactionChargeKobo === null
        ? {}
        : {
            paystack_transaction_charge_kobo: collection.transactionChargeKobo,
          }),
    },
    extraParams: { p_paystack_subaccount_code: collection.subaccountCode },
    rpc: useGiglSettlementRpc
      ? 'record_paystack_direct_split_settlement_gigl_v1'
      : 'record_paystack_direct_split_settlement',
  };
}
