import 'server-only';

import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { createAnonClient } from '@/lib/supabase/anon';

export type ChatwootMerchantCurrency = {
  country?: string;
  currency: string;
};

/** Read only the published currency fields for a server-resolved merchant. */
export async function loadChatwootMerchantCurrency(
  merchantId: string
): Promise<ChatwootMerchantCurrency | null> {
  try {
    const { data, error } = await createAnonClient()
      .from('merchants')
      .select('country, payout_currency')
      .eq('id', merchantId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      country: data.country?.trim().toUpperCase() || undefined,
      currency: resolveMerchantCurrencyConfig(data).code.trim().toUpperCase(),
    };
  } catch {
    return null;
  }
}
