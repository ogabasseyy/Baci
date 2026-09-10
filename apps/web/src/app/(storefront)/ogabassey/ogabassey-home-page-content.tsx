import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Hero } from '@/components/storefront/ogabassey/components/Hero';
import type { LaunchProductSlide } from '@/components/storefront/ogabassey/components/LaunchCarousel';
import { loadUnpublishedStorefront } from '@/components/storefront/unpublished-storefront';
import { OGABASSEY_TITLE } from '@/config/ogabassey';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { resolveMerchantContextIdentifier } from '@/lib/storefront-route-identifier';
import { OgabasseyHomeDynamicContent } from './ogabassey-home-dynamic-content';

interface OgabasseyHomePageContentProps {
  /** When the static parent already painted a committed mobile text LCP, skip
   *  the request-scoped mobile carousel so a later product title cannot steal
   *  Slow-4G LCP. Desktop grid still streams after the publication guard. */
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
 * static parent may prepare slide data and paint the committed mobile text LCP,
 * but this component is the sole owner of the desktop Hero, utility panel, and
 * PDP links.
 */
export async function OgabasseyHomePageContent({
  omitMobileCarousel = false,
  pathPrefix,
  shellMerchantId,
  shellSlides,
}: OgabasseyHomePageContentProps) {
  await connection();

  const headersList = await headers();
  const merchant = await getRequestScopedMerchant(
    resolveOgabasseyHomeMerchantIdentifier(headersList)
  );
  const resolvedPathPrefix = resolveOgabasseyHomePathPrefix(
    headersList,
    pathPrefix
  );

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
          omitMobileCarousel={omitMobileCarousel}
          slides={requestMerchantShellSlides}
        />
      ) : (
        <h1 className="sr-only">{OGABASSEY_TITLE}</h1>
      )}
      <Suspense fallback={null}>
        <OgabasseyHomeDynamicContent
          merchant={merchant}
          pathPrefix={resolvedPathPrefix}
        />
      </Suspense>
    </>
  );
}
