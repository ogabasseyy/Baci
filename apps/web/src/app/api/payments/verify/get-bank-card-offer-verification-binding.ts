import { getAuthenticatedUser } from '@/lib/supabase/mobile-auth';
import { doesBankOfferMerchantMatch } from './does-bank-offer-merchant-match';
import { readSessionlessPaymentReferenceSnapshot } from './read-sessionless-payment-reference-snapshot';

export async function getBankCardOfferVerificationBinding(
  request: Request,
  reference: string,
  merchantSlug: string | undefined
) {
  if (!merchantSlug) return 'unavailable';

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
