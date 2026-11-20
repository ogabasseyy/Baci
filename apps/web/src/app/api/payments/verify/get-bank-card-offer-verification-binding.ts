import { getAuthenticatedUser } from '@/lib/supabase/mobile-auth';
import { readSessionlessPaymentReferenceSnapshot } from './sessionless-payment-reference-snapshot';

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

    const { data, error } = await auth.supabase
      .from('merchants')
      .select('id')
      .eq('slug', merchantSlug)
      .eq('id', snapshot.merchantId)
      .maybeSingle();

    if (error) return 'unavailable';
    if (data?.id !== snapshot.merchantId) return null;

    return { orderId: snapshot.orderId, merchantId: snapshot.merchantId };
  } catch {
    return 'unavailable';
  }
}
