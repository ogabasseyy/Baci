import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateAdminWalletFunding } from '@/app/api/shipping/quotes/admin-order-gigl-quote.helpers';

export type GiglShippingFundingMode = 'platform' | 'merchant_wallet';

/**
 * Resolves the owner-only "Baci pays shipping" flag through a DEFINER RPC (the
 * flag table is private). Any failure or unknown value reads as the normal
 * merchant-wallet mode, so the flag can only ever widen access when the
 * database positively says 'platform'.
 */
export async function readGiglShippingFundingMode(
  supabase: SupabaseClient,
  merchantId: string
): Promise<GiglShippingFundingMode> {
  const result = await supabase.rpc('get_gigl_shipping_funding_mode', {
    p_merchant_id: merchantId,
  });
  return !result?.error && result?.data === 'platform'
    ? 'platform'
    : 'merchant_wallet';
}

export type AdminGiglQuoteFunding =
  | {
      ok: true;
      availableBalance: number;
      shortfall: number;
      canBook: boolean;
      paidByBaci?: true;
    }
  | { ok: false };

/** Funding summary for the admin quote response (wallet or "Paid by Baci"). */
export async function resolveAdminGiglQuoteFunding(
  supabase: SupabaseClient,
  merchantId: string,
  price: number,
  readBalance: () => Promise<number | null>
): Promise<AdminGiglQuoteFunding> {
  if (
    (await readGiglShippingFundingMode(supabase, merchantId)) === 'platform'
  ) {
    return {
      ok: true,
      availableBalance: 0,
      shortfall: 0,
      canBook: true,
      paidByBaci: true,
    };
  }
  const balance = await readBalance();
  if (balance === null) return { ok: false };
  return { ok: true, ...calculateAdminWalletFunding(price, balance) };
}
