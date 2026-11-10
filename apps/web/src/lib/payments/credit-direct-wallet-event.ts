import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { creditDirectWalletFundingSchema } from '@/schemas/credit-direct-wallet-event';

/** Only the existing signature-verified webhook client may bind provider facts. */
export async function verifyCreditDirectWalletEvent({
  supabase,
  orderId,
  merchantId,
  reference,
  merchantCompleted,
  providerAmount,
}: {
  supabase: Pick<SupabaseClient, 'rpc'>;
  orderId: string;
  merchantId: string;
  reference: string;
  merchantCompleted: boolean;
  providerAmount: number | null;
}) {
  if (
    providerAmount === null ||
    !Number.isFinite(providerAmount) ||
    providerAmount <= 0
  )
    return null;
  const { data, error } = await supabase.rpc(
    'verify_credit_direct_wallet_event',
    {
      p_order_id: orderId,
      p_merchant_id: merchantId,
      p_reference: reference,
      p_merchant_completed: merchantCompleted,
      p_provider_amount: providerAmount,
    }
  );
  if (error) {
    if (error.code === '40001') return 'retry' as const;
    logger.warn({
      message: 'Credit Direct wallet verification RPC failed',
      code: error.code,
      orderId,
    });
    return null;
  }
  const parsed = creditDirectWalletFundingSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
