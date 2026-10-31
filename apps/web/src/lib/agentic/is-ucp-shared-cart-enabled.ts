import { createAnonMerchantFeatureLookup } from '@/lib/cart/merchant-resolution';
import { merchantHasFeature } from '@/lib/merchant-has-feature';
import { createAnonClient } from '@/lib/supabase/anon';

/**
 * Reads the merchant's live shared-cart enrollment. The canonical UCP cart
 * and the cart routes' availability gate share this reader, so both decide
 * from the same premium_features grant. Throws when the merchant cannot be
 * read; callers fail closed.
 */
export async function isUcpSharedCartEnabled(
  merchantId: string
): Promise<boolean> {
  const features = await createAnonMerchantFeatureLookup(createAnonClient())(
    merchantId
  );
  if (!features) throw new Error('Merchant unavailable');
  return merchantHasFeature(features, 'shared_cart');
}
