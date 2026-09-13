import { buildLaunchSlides } from '@/components/storefront/ogabassey/components/build-launch-slides';
import { Hero } from '@/components/storefront/ogabassey/components/Hero';
import type { getRequestScopedMerchant } from '@/lib/cached-data';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { buildStoreUrl } from '@/lib/store-url';
import { loadOgabasseyLaunchProducts } from './ogabassey-home-launch-products';

type Merchant = Pick<
  NonNullable<Awaited<ReturnType<typeof getRequestScopedMerchant>>>,
  'id' | 'slug' | 'custom_domain' | 'country' | 'payout_currency'
>;

/** Called only after the request-scoped publication guard. Recover a timed-out
 * shell independently of below-fold catalog and navigation queries. */
export async function OgabasseyHomeRecoveryHero({
  merchant,
}: {
  merchant: Merchant;
}) {
  const products = await loadOgabasseyLaunchProducts(
    merchant.id,
    resolveMerchantCurrencyConfig(merchant)
  );
  return (
    <Hero
      omitDocumentHeading
      prioritizeMobileHeroImage
      slides={buildLaunchSlides(products, buildStoreUrl(merchant))}
    />
  );
}
