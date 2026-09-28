import { buildLaunchSlides } from '@/components/storefront/ogabassey/components/build-launch-slides';
import { Hero } from '@/components/storefront/ogabassey/components/Hero';
import { OGABASSEY_HOME_HERO_SNAPSHOT_TENANT } from '@/config/ogabassey-home-hero-snapshot-tenant';
import type { getRequestScopedMerchant } from '@/lib/cached-data';
import { resolveOgabasseyHomeHeroSnapshot } from '@/lib/ogabassey-home-hero-snapshot';
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
  const slides = buildLaunchSlides(products, buildStoreUrl(merchant));
  // Same lookup as the shell path, against the live recovery slides: a
  // snapshot only applies when the manifest holds this exact slide-0 URL.
  const slideZeroSnapshot = resolveOgabasseyHomeHeroSnapshot(
    OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
    slides[0]?.imageUrl
  );
  return (
    <Hero
      omitDocumentHeading
      omitMobileCarousel={omitMobileCarousel}
      prioritizeMobileHeroImage
      slides={slides}
      slideZeroSnapshot={slideZeroSnapshot}
    />
  );
}
