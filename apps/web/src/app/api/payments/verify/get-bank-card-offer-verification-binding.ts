import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from '@/lib/supabase/mobile-auth';
import { readSessionlessPaymentReferenceSnapshot } from './read-sessionless-payment-reference-snapshot';

export async function getBankCardOfferVerificationBinding(
  request: Request,
  reference: string,
  merchantSlug: string | undefined
) {
  if (!merchantSlug) return null;

  try {
    const auth = await getAuthenticatedUser(request);
    if (auth?.authMode !== 'cookie') return null;

    const snapshot = await readSessionlessPaymentReferenceSnapshot(
      auth.supabase,
      reference
    );
    if (!snapshot) return null;

    const matches = await doesBankOfferMerchantMatch(
      auth.supabase,
      merchantSlug,
      snapshot.merchantId
    );
    if (!matches) return null;

    return { orderId: snapshot.orderId, merchantId: snapshot.merchantId };
  } catch {
    return 'unavailable';
  }
}

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
