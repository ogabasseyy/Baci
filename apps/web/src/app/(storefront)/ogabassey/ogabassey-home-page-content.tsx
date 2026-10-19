import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Hero } from '@/components/storefront/ogabassey/components/Hero';
import type { LaunchProductSlide } from '@/components/storefront/ogabassey/components/LaunchCarousel';
import { loadUnpublishedStorefront } from '@/components/storefront/unpublished-storefront';
import { OGABASSEY_TITLE, OGABASSEY_URL } from '@/config/ogabassey';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { resolveMerchantContextIdentifier } from '@/lib/storefront-route-identifier';
import { OgabasseyHomeDynamicContent } from './ogabassey-home-dynamic-content';
import { OgabasseyHomeHeroReserveFallback } from './ogabassey-home-hero-reserve-fallback';
import { loadOgabasseyLaunchProducts } from './ogabassey-home-launch-products';
import { OgabasseyHomeRecoveryHero } from './ogabassey-home-recovery-hero';

const OGABASSEY_DOMAIN_IDENTIFIER = new URL(OGABASSEY_URL).hostname;

interface OgabasseyHomePageContentProps {
  /** True only when the route segment itself proved the canonical custom domain
   *  (`ogabassey.com`) beneath `OgabasseyStaticHomePage`. */
  canonicalDomain?: boolean;
  /** Skip Hero's H1 when a parent already committed the document title. */
  omitDocumentHeading?: boolean;
  /** Optional alternate layout: omit the mobile carousel while preserving
   *  the publication-checked desktop grid. */
  omitMobileCarousel?: boolean;
  /** Static per-route path prefix supplied by the parent. */
  pathPrefix: string;
  /** Cached shell data is safe to prepare before request resolution, but must
   *  not become shopping UI until this component confirms publication. */
  shellMerchantId: string | null;
  shellSlides: LaunchProductSlide[] | null;
}

function resolveOgabasseyHomeMerchantIdentifier(headersList: Headers): string {
  return resolveMerchantContextIdentifier(headersList) || OGABASSEY_TEMPLATE_ID;
}

export function resolveOgabasseyHomePathPrefix(
  headersList: Headers,
  staticPathPrefix: string
): string {
  return resolveMerchantContextIdentifier(headersList) ? '' : staticPathPrefix;
}

/**
 * Request-scoped publication boundary for the homepage shopping surface. The
 * static parent prepares slide data and critical styles; this component owns
 * the visible product Hero, utility panel, and PDP links on both viewports.
 */
export async function OgabasseyHomePageContent({
  canonicalDomain = false,
  omitDocumentHeading = false,
  omitMobileCarousel = false,
  pathPrefix,
  shellMerchantId,
  shellSlides,
}: OgabasseyHomePageContentProps) {
  let merchant: Awaited<ReturnType<typeof getRequestScopedMerchant>>;
  let resolvedPathPrefix: string;

  // On the canonical custom-domain route (`canonicalDomain && pathPrefix === ''`
  // beneath `OgabasseyStaticHomePage`, which sets `omitDocumentHeading`), the
  // route segment proved `ogabassey.com` and the link prefix is always
  // root-relative (`''`). Resolving the cached merchant record directly here
  // avoids `connection()` and `headers()`, which Next.js 16 delays until
  // `RenderStage.Dynamic` (after ~146 KB of `<script>self.__next_f.push(...)`
  // chunks). That allows `<Hero>` to flush in `RenderStage.Static` in the
  // initial HTML chunk while preserving the publication (`!merchant.is_published`),
  // 404 (`!merchant`), and tenant-id (`shellMerchantId === merchant.id`) guards
  // bounded by the `merchant` `'use cache'` revalidation window (60s revalidate).
  if (canonicalDomain && omitDocumentHeading && pathPrefix === '') {
    merchant = await getRequestScopedMerchant(OGABASSEY_DOMAIN_IDENTIFIER);
    resolvedPathPrefix = '';
  } else {
    await connection();

    const headersList = await headers();
    merchant = await getRequestScopedMerchant(
      resolveOgabasseyHomeMerchantIdentifier(headersList)
    );
    resolvedPathPrefix = resolveOgabasseyHomePathPrefix(
      headersList,
      pathPrefix
    );
  }

  if (!merchant) {
    notFound();
  }

  const isDevelopment = process.env.NODE_ENV === 'development';
  if (!merchant.is_published && !isDevelopment) {
    const StoreNotPublished = await loadUnpublishedStorefront();

    return <StoreNotPublished businessName={merchant.business_name} />;
  }

  // The static shell is built from the canonical OgaBassey record before
  // request resolution. Bind it to that exact tenant so a reassigned domain or
  // stale identifier mapping can never render another merchant's catalog.
  const requestMerchantShellSlides =
    shellMerchantId === merchant.id ? shellSlides : null;

  return (
    <>
      {requestMerchantShellSlides ? (
        <Hero
          prioritizeMobileHeroImage
          omitDocumentHeading={omitDocumentHeading}
          omitMobileCarousel={omitMobileCarousel}
          slides={requestMerchantShellSlides}
        />
      ) : omitDocumentHeading ? null : (
        <h1 className="sr-only">{OGABASSEY_TITLE}</h1>
      )}
      {!requestMerchantShellSlides ? (
        <Suspense
          fallback={
            <OgabasseyHomeHeroReserveFallback
              omitMobileCarousel={omitMobileCarousel}
            />
          }
        >
          <OgabasseyHomeRecoveryHero
            merchant={merchant}
            omitMobileCarousel={omitMobileCarousel}
            productsPromise={loadOgabasseyLaunchProducts(
              merchant.id,
              resolveMerchantCurrencyConfig(merchant)
            )}
          />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <OgabasseyHomeDynamicContent
          merchant={merchant}
          pathPrefix={resolvedPathPrefix}
        />
      </Suspense>
    </>
  );
}
