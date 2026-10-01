import { buildLaunchSlides } from '@/components/storefront/ogabassey/components/build-launch-slides';
import { Hero } from '@/components/storefront/ogabassey/components/Hero';
import type { getRequestScopedMerchant } from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import type { loadOgabasseyLaunchProducts } from './ogabassey-home-launch-products';

type Merchant = Pick<
  NonNullable<Awaited<ReturnType<typeof getRequestScopedMerchant>>>,
  'id' | 'slug' | 'custom_domain' | 'country' | 'payout_currency'
>;

/** Called only after the request-scoped publication guard. Recover a timed-out
 * shell independently of below-fold catalog and navigation queries. */
export async function OgabasseyHomeRecoveryHero({
  merchant,
  omitMobileCarousel = false,
  productsPromise,
}: {
  merchant: Merchant;
  omitMobileCarousel?: boolean;
  productsPromise: ReturnType<typeof loadOgabasseyLaunchProducts>;
}) {
  const products = await productsPromise;
  return (
    <Hero
      omitDocumentHeading
      omitMobileCarousel={omitMobileCarousel}
      prioritizeMobileHeroImage
      slides={buildLaunchSlides(products, buildStoreUrl(merchant))}
    />
  );
}
