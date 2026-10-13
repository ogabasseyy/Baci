import type { SupabaseClient } from '@supabase/supabase-js';

export type MerchantDetails = {
  business_address: string | null;
  business_name: string | null;
  phone: string | null;
  country: string | null;
  payout_currency: string | null;
  state_code?: string | null;
};

export type MerchantDetailsResult =
  | MerchantDetails
  | null
  | { error: string; ok: false; status: number };

/** Loads only the durable merchant fields needed to build a trusted sender. */
export async function resolveMerchantDetails(
  supabase: SupabaseClient,
  merchantId: string
): Promise<MerchantDetailsResult> {
  const { data, error } = await supabase
    .from('merchants')
    .select('business_name, business_address, phone, country, payout_currency')
    .eq('id', merchantId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching merchant for sender info:', error);
    return {
      error: 'Failed to resolve merchant sender',
      ok: false,
      status: 500,
    };
  }

  return (data as MerchantDetails | null) ?? null;
}
