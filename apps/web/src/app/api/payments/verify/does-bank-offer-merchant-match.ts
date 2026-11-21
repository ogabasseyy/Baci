import type { SupabaseClient } from '@supabase/supabase-js';

export async function doesBankOfferMerchantMatch(
  client: SupabaseClient,
  slug: string,
  merchantId: string
): Promise<boolean> {
  const { data, error } = await client
    .from('merchants')
    .select('id')
    .eq('slug', slug)
    .eq('id', merchantId)
    .maybeSingle();

  if (error) throw error;
  return data?.id === merchantId;
}
