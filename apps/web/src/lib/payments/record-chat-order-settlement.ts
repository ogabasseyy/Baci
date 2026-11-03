import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveChatOrderSettlementRouting } from '@/lib/payments/resolve-chat-order-settlement-routing';

/**
 * Records the settlement for a chat order converted on payment. supabase-js
 * returns RPC failures instead of throwing, so this throws on a returned
 * error: a recorder refusal (for example a subaccount that is not the
 * merchant's) must reach the caller's log, never pass as success.
 */
export async function recordChatOrderSettlement(args: {
  gateway: string;
  gatewayResponse: unknown;
  grossAmount: number;
  merchantId: string;
  orderId: string;
  platformFee: number;
  reference: string;
  supabase: Pick<SupabaseClient, 'rpc'>;
}): Promise<void> {
  // Baci-owned chat DVAs stay spendable; a subaccount split is history only.
  const routing = resolveChatOrderSettlementRouting({
    gateway: args.gateway,
    gatewayResponse: args.gatewayResponse,
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
