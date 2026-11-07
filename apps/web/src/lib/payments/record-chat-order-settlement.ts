import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { resolveChatOrderSettlementRouting } from '@/lib/payments/resolve-chat-order-settlement-routing';

type ChatSettlementSupabase = Pick<SupabaseClient, 'from' | 'rpc'>;

const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Records the settlement for a chat order converted on payment. Any failure
 * (an unprovable Paystack payload, or a recorder refusal that supabase-js
 * returns instead of throwing) files a durable merchant_settlement_failed
 * review, because the webhook is acknowledged and Paystack will not
 * redeliver, and then rethrows the original error so the caller logs it.
 */
export async function recordChatOrderSettlement(
  args: ChatSettlementArgs
): Promise<void> {
  try {
    await recordSettlement(args);
  } catch (error) {
    await fileSettlementReview(args, error);
    throw error;
  }
}

type ChatSettlementArgs = {
  gateway: string;
  gatewayResponse: unknown;
  grossAmount: number;
  merchantId: string;
  orderId: string;
  platformFee: number;
  reference: string;
  supabase: ChatSettlementSupabase;
};

async function fileSettlementReview(
  args: ChatSettlementArgs,
  error: unknown
): Promise<void> {
  const { error: reviewError } = await args.supabase
    .from('reconciliation_review')
    .insert({
      issue_type: 'merchant_settlement_failed',
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        gateway: args.gateway,
        source: 'chat_order',
      },
      order_id: args.orderId,
      paystack_ref: args.reference,
      reason:
        'Chat-order settlement was not recorded; reconcile it against the Paystack transaction.',
    });
  // An open review for this order already exists on a redelivery. Any other
  // failure is logged with the original settlement error and never thrown,
  // so the caller still sees (and logs) the settlement error itself.
  if (
    reviewError &&
    (reviewError as { code?: string }).code !== POSTGRES_UNIQUE_VIOLATION
  ) {
    logger.error({
      message: 'Failed to file chat-order settlement review',
      orderId: args.orderId,
      reference: args.reference,
      reviewError: reviewError.message,
      settlementError: error instanceof Error ? error.message : String(error),
    });
  }
}

async function recordSettlement(args: ChatSettlementArgs): Promise<void> {
  // Baci-owned chat DVAs stay spendable; a subaccount split is history only.
  const routing = resolveChatOrderSettlementRouting({
    gateway: args.gateway,
    gatewayResponse: args.gatewayResponse,
    grossAmountKobo: Math.round(args.grossAmount * 100),
  });
  const { error } = await args.supabase.rpc(routing.rpc, {
    ...routing.extraParams,
    p_merchant_id: args.merchantId,
    p_source_type: 'order',
    p_source_id: args.orderId,
    p_gateway: args.gateway,
    p_gateway_reference: args.reference,
    p_gross_amount: args.grossAmount,
    p_gateway_fee: 0,
    p_platform_fee: args.platformFee,
    p_description: `Chat order payment via ${args.gateway}`,
    // Δ-29 / Δ-59: traceability — gateway-side ref lives in metadata only
    // (chat-order path has no separate BAC-* yet); the key is
    // gateway-prefixed, not hardcoded paystack.
    p_metadata: {
      [`${args.gateway}_reference`]: args.reference,
      ...routing.extraMetadata,
    },
  });
  if (error) {
    throw new Error(
      `chat_order_settlement_failed: ${routing.rpc}: ${error.message}`
    );
  }
}
