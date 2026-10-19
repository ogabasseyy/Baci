import type { Metadata } from 'next';
import { Suspense } from 'react';
import { resolveOgabasseyHomeHeroShell } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data';
import {
  getSettledCanonicalOgabasseyHomeStateBox,
  hydrateSettledCanonicalOgabasseyHomeStateFromParams,
  recordSettledCanonicalOgabasseyHomeState,
  type SettledCanonicalOgabasseyHomeState,
} from '@/app/(storefront)/ogabassey/ogabassey-home-settled-state';
import { OGABASSEY_URL } from '@/config/ogabassey';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { getBrandMatchedTwitterHandle } from '@/lib/brand-matched-twitter-handle';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { buildFactualStorefrontDescription } from '@/lib/storefront-seo/build-factual-storefront-description';
import { buildHomeSeoDecision } from '@/lib/storefront-seo/build-home-seo-decision';
import { toNextRobotsMetadata } from '@/lib/storefront-seo/to-next-robots-metadata';
import { isValidMerchantIdentifier } from '@/lib/validation';
import {
  buildOgabasseyStaticHomeMetadata,
  buildStorefrontLanguageAlternates,
  getOgabasseyHomePathPrefix,
  isOgabasseyCanonicalDomainSlug,
  isOgabasseyHomeIdentifier,
  OGABASSEY_DOMAIN_IDENTIFIER,
} from './is-ogabassey-home-identifier';
import { OgabasseyHomeCommittedLcp } from './ogabassey-home-committed-lcp';
// Statically imported alongside OgabasseyHomeCommittedLcp so
// renderOgabasseyStaticHomePage returns a synchronous RSC element during
// RenderStage.Static; GenericStorefrontHomePage remains dynamically imported.
import { OgabasseyStaticHomePage } from './ogabassey-static-home-page';

function warmOgabasseyHomeHeroShell(): void {
  void resolveOgabasseyHomeHeroShell().catch(() => undefined);
}

export function generateStaticParams(): Array<{ slug: string }> {
  return [OGABASSEY_DOMAIN_IDENTIFIER, OGABASSEY_TEMPLATE_ID].map((slug) => ({
    slug,
  }));
}

async function renderGenericStorefrontHomePage(
  params: Promise<{ slug: string }>
) {
  const { GenericStorefrontHomePage } = await import(
    './generic-storefront-home-page'
  );

  return <GenericStorefrontHomePage params={params} />;
}

function renderOgabasseyStaticHomePage(slug: string) {
  warmOgabasseyHomeHeroShell();

  return (
    <OgabasseyStaticHomePage pathPrefix={getOgabasseyHomePathPrefix(slug)} />
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const stateBox = getSettledCanonicalOgabasseyHomeStateBox(params);
  const { slug } = await params;

  if (isOgabasseyHomeIdentifier(slug)) {
    // On the canonical custom-domain route (ogabassey.com), await the
    // request-memoized hero shell alongside the merchant lookup so
    // metadata-blocking renders (Lighthouse/PSI and bots) and static-stage
    // renders settle both promises before the initial HTML chunk flushes.
    // resolveOgabasseyHomeHeroShell() already catches ordinary errors and
    // returns null while rethrowing Next.js interrupts via unstable_rethrow().
    // On the /ogabassey path route, warm the shell without delaying head tags.
    let merchant: Awaited<ReturnType<typeof getRequestScopedMerchant>>;
    if (isOgabasseyCanonicalDomainSlug(slug)) {
      const [resolvedMerchant, heroShell] = await Promise.all([
        getRequestScopedMerchant(slug),
        resolveOgabasseyHomeHeroShell(),
      ]);
      recordSettledCanonicalOgabasseyHomeState({
        box: stateBox,
        heroShell,
        merchant: resolvedMerchant,
        params,
        slug,
      });
      merchant = resolvedMerchant;
    } else {
      warmOgabasseyHomeHeroShell();
      merchant = await getRequestScopedMerchant(slug);
    }
    const robots = toNextRobotsMetadata(
      buildHomeSeoDecision({
        isPublished: merchant?.is_published === true,
        canonicalUrl: OGABASSEY_URL,
        merchantName: merchant?.business_name ?? null,
      })
    );

    return buildOgabasseyStaticHomeMetadata(robots);
  }

  // Skip database query for invalid identifiers (like static asset requests)
  if (!isValidMerchantIdentifier(slug)) {
    return {
      title: 'Not Found',
      description: 'The page you are looking for does not exist.',
    };
  }

  // Use request-scoped lookup (deduplicates with layout, retries on transient errors)
  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    return {
      title: 'Store Not Found',
      description: 'The store you are looking for does not exist.',
    };
  }

  const { metadataTitle, title } = buildStorefrontMetadataTitle({
    title:
      merchant.site_title?.trim() ||
      (merchant.business_name
        ? `${merchant.business_name} - Official Online Store`
        : 'Official Online Store'),
    fallback: 'Official Online Store',
  });
  const baseUrl = buildStoreUrl(merchant);
  const description = buildFactualStorefrontDescription({
    businessName: merchant.business_name,
    siteDescription: merchant.site_description,
    siteTagline: merchant.site_tagline,
    categoryName: null,
    country: merchant.country,
  });
  const robots = toNextRobotsMetadata(
    buildHomeSeoDecision({
      isPublished: merchant.is_published === true,
      canonicalUrl: baseUrl,
      merchantName: merchant.business_name ?? null,
    })
  );

  const socialMedia = merchant.social_media as Record<string, string> | null;
  const twitterHandle = getBrandMatchedTwitterHandle(
    merchant.business_name,
    socialMedia?.twitter
  );

  return {
    metadataBase: new URL(baseUrl),
    title: metadataTitle,
    description: description,
    alternates: {
      canonical: baseUrl,
      languages: buildStorefrontLanguageAlternates(baseUrl, merchant.country),
    },
    robots,
    openGraph: {
      title: title,
      description: description,
      url: baseUrl,
      type: 'website',
      siteName: merchant.business_name,
      ...(merchant.logo_url && {
        images: [
          { url: merchant.logo_url, alt: `${merchant.business_name} logo` },
        ],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title: title,
      description: description,
      ...(merchant.logo_url && { images: [merchant.logo_url] }),
      ...(twitterHandle && {
        site: twitterHandle,
      }),
    },
    // Dynamic Favicon Support
    icons: {
      icon:
        merchant.favicon_svg_url ||
        merchant.favicon_png_32_url ||
        '/favicon.ico',
      shortcut: merchant.favicon_png_32_url || '/favicon.ico',
      apple: merchant.favicon_apple_touch_url || '/favicon.ico',
    },
  };
}

async function renderStorefrontHomeRouteAsync(
  params: Promise<{ slug: string }>,
  stateBox: SettledCanonicalOgabasseyHomeState
) {
  const { slug } = await params;

  if (isOgabasseyHomeIdentifier(slug)) {
    if (isOgabasseyCanonicalDomainSlug(slug)) {
      const [resolvedMerchant, heroShell] = await Promise.all([
        Promise.resolve(getRequestScopedMerchant(slug)).catch(() => null),
        Promise.resolve(resolveOgabasseyHomeHeroShell()).catch(() => null),
      ]);
      recordSettledCanonicalOgabasseyHomeState({
        box: stateBox,
        heroShell,
        merchant: resolvedMerchant,
        params,
        slug,
      });
    }

    return renderOgabasseyStaticHomePage(slug);
  }

  return renderGenericStorefrontHomePage(params);
}

function StorefrontHomeRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const stateBox = getSettledCanonicalOgabasseyHomeStateBox(params);
  const settled = hydrateSettledCanonicalOgabasseyHomeStateFromParams(params);
  if (settled?.slug && isOgabasseyHomeIdentifier(settled.slug)) {
    return renderOgabasseyStaticHomePage(settled.slug);
  }

  return renderStorefrontHomeRouteAsync(params, stateBox);
}

export default function StorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <>
      <OgabasseyHomeCommittedLcp params={params} />
      <Suspense fallback={null}>
        <StorefrontHomeRoute params={params} />
      </Suspense>
    </>
  );
}
