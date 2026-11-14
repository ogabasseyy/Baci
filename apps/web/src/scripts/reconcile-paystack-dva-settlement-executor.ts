// The merchant_settlement step of the manual A2 reconcile script, extracted
// from reconcile-paystack-dva-executors.ts to keep both files under the
// 300-line cap. It mirrors the paid-order settlement executor's routing.

import type { StepExecutor } from '@/lib/payments/apply-paid-order-side-effects';
import { resolveSettlementRpcRouting } from '@/lib/payments/resolve-settlement-rpc-routing';
import { extractVerifiedGatewayFeeNgn } from '@/lib/payments/verified-gateway-fee';
import { calculatePlatformFee } from '@/lib/paystack';
import type { BuildScriptExecutorsArgs } from './reconcile-paystack-dva-executors';

export function buildReconcileSettlementExecutor(
  args: Pick<
    BuildScriptExecutorsArgs,
    | 'actor'
    | 'order'
    | 'paystackReference'
    | 'rawPlatformFee'
    | 'richOrder'
    | 'supabase'
    | 'transaction'
  >
): StepExecutor {
  const {
    actor,
    order,
    paystackReference,
    rawPlatformFee,
    richOrder,
    supabase,
    transaction,
  } = args;

return async (ctx) => {
  // Mirror the finite-number guard used for rawPlatformFee below: a
  // legitimate ₦0 gross is preserved instead of silently coerced to 0.
  // A paid Paystack transaction never carries amount=0 in practice,
  // but keeping both guards consistent makes the intent obvious.
  const parsedGross = Number(transaction.amount);
  const grossAmount = Number.isFinite(parsedGross) ? parsedGross : 0;
  // Δ-0b: source the gateway fee from the verified Paystack response
  // (passed via StepContext.gatewayResponse).
  const gatewayFee = extractVerifiedGatewayFeeNgn(
    'paystack',
    ctx.gatewayResponse
  );
  // Distinguish "missing" from "legitimate zero". `Number(0) || X`
  // would treat a stored 0 the same as null/NaN and recompute, which
  // diverges from the webhook path that respects the on-record value.
  const parsedPlatformFee =
    rawPlatformFee === null || rawPlatformFee === undefined
      ? Number.NaN
      : Number(rawPlatformFee);
  const platformFee = Number.isFinite(parsedPlatformFee)
    ? parsedPlatformFee
    : calculatePlatformFee(grossAmount * 100).platformFee / 100;

  // Storefront DVAs usually split to the merchant subaccount: record those
  // as history, keep Baci-collected money spendable, and refuse a payload
  // that proves neither (throws paystack_settlement_collection_unknown).
  // Mirror paid-order-settlement-executor: GIGL customer-checkout/wallet
  // orders carry an economics snapshot and need the GIGL variant so the
  // retained delivery-fee accounting is not dropped. p_platform_fee stays
  // the base fee; the SQL wrapper adds the retention.
  const useGiglSettlementRpc =
    richOrder.shipping_funding_source != null &&
    richOrder.shipping_provider?.trim().toUpperCase() === 'GIGL';
  const routing = resolveSettlementRpcRouting({
    gatewayResponse: ctx.gatewayResponse,
    grossAmountKobo: Math.round(grossAmount * 100),
    isRedvaultDirectSettlement: false,
    settlementGateway: 'paystack',
    useGiglSettlementRpc,
  });
  const { error: settlementError } = await supabase.rpc(
    routing.rpc,
    {
      ...routing.extraParams,
      p_merchant_id: order.merchant_id,
      p_source_type: 'order',
      p_source_id: order.id,
      p_gateway: 'paystack',
      // Δ-22: settlement key is our BAC-*; Paystack ref → metadata only.
      p_gateway_reference:
        transaction.gateway_reference ?? paystackReference,
      p_gross_amount: grossAmount,
      p_gateway_fee: gatewayFee,
      p_platform_fee: platformFee,
      p_description: 'Order payment via paystack (manual reconcile)',
      p_metadata: {
        paystack_reference: paystackReference,
        verified_gateway_fee: gatewayFee,
        reconciled_by: actor,
        ...routing.extraMetadata,
      },
    }
  );
  if (settlementError) {
    throw new Error(settlementError.message);
  }
  return {
    gross_amount: grossAmount,
    gateway_fee: gatewayFee,
    platform_fee: platformFee,
  };
};
}
