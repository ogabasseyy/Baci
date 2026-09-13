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
import { OgabasseyHomeRecoveryHero } from './ogabassey-home-recovery-hero';

interface OgabasseyHomePageContentProps {
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
  omitDocumentHeading = false,
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
          prioritizeMobileHeroImage
          omitDocumentHeading={omitDocumentHeading}
          omitMobileCarousel={omitMobileCarousel}
          slides={requestMerchantShellSlides}
        />
      ) : omitDocumentHeading ? null : (
        <h1 className="sr-only">{OGABASSEY_TITLE}</h1>
      )}
      {!requestMerchantShellSlides ? (
        <Suspense fallback={null}>
          <OgabasseyHomeRecoveryHero merchant={merchant} />
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
