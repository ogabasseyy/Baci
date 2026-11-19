import type { SupabaseClient } from '@supabase/supabase-js';
import { merchantShippingWalletBalanceSchema } from '@/schemas/merchant-wallet-funding';

export type MerchantShippingWalletBalance =
  | { ok: true; availableBalance: number }
  | { ok: false };

/**
 * Reads only the merchant wallet's spendable balance for GIG shipping (available
 * balance minus Paystack direct-split exposure, as reserve_merchant_shipping_charge spends). The
 * DEFINER RPC admits the owner and staff granted orders.fulfill, so fulfil
 * staff see whether booking is covered without get_wallet_summary's earnings,
 * withdrawals, settlements or payout schedule.
 */
export async function readMerchantShippingWalletBalance(
  supabase: SupabaseClient,
  merchantId: string
): Promise<MerchantShippingWalletBalance> {
  const { data, error } = await supabase.rpc(
    'get_merchant_shipping_wallet_balance',
    { p_merchant_id: merchantId }
  );
  if (error) return { ok: false };
  const parsed = merchantShippingWalletBalanceSchema.safeParse(data);
  return parsed.success
    ? { ok: true, availableBalance: parsed.data }
    : { ok: false };
}
