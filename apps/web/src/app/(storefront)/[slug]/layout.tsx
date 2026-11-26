import '@/app/(storefront)/storefront-cart-drawer.css';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type React from 'react';
import { Suspense } from 'react';
import { ShellChromeLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { resolveOgabasseyHomeHeroShell } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data';
import {
  clearSettledCanonicalOgabasseyHomeState,
  getSettledCanonicalOgabasseyHomeStateBox,
  isStorefrontHomeRequest,
  recordSettledCanonicalOgabasseyHomeState,
  settleCanonicalOgabasseyHomeMerchant,
} from '@/app/(storefront)/ogabassey/ogabassey-home-settled-state';
import { StorefrontLcpCopyStyle } from '@/app/(storefront)/storefront-lcp-copy-style';
import { AdAttributionCapture } from '@/components/storefront/ad-attribution-capture';
import {
  DEFAULT_STOREFRONT_APPEARANCE,
  resolveStorefrontAppearance,
  type StorefrontAppearance,
} from '@/components/storefront/storefront-appearance';
import { loadUnpublishedStorefront } from '@/components/storefront/unpublished-storefront';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { getStorefrontNavigationCategories } from '@/lib/cached-categories';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { isValidMerchantIdentifier } from '@/lib/validation';
import {
  isOgabasseyCanonicalDomainSlug,
  isOgabasseyHomeIdentifier,
} from './(home)/is-ogabassey-home-identifier';
import { buildStorefrontMerchantMetadata } from './build-storefront-merchant-metadata';
import {
  StorefrontClientShell,
  StorefrontShellBridgeSync,
  StorefrontShellUnpublishedSync,
} from './storefront-client-shell';
import { StorefrontPprStaticShell } from './storefront-ppr-static-shell';
import {
  resolveBridgeChatwootConfig,
  resolveBridgeExperienceRoutes,
  StorefrontBridgeHeadEffects,
  StorefrontOgabasseyHeaderBridge,
} from './storefront-shell-bridge-chrome';
import { StorefrontShellFrame } from './storefront-shell-frame';
import {
  getStorefrontShellSnapshot,
  getStorefrontShellSnapshotBase,
} from './storefront-shell-snapshot';
import { StorefrontThemeFrame } from './storefront-theme-frame';

// Storefront SSR runs next to Supabase primary (eu-west-1 / dub1 via vercel.json).

const STORE_NOT_FOUND_METADATA: Metadata = {
  title: 'Store Not Found',
  // Replace root metadata alternates so noindex fallback pages do not inherit a canonical.
  alternates: null,
  robots: {
    index: false,
    follow: true,
  },
  // Replace root verification so platform google-adsense-account meta does not bleed onto fallback pages.
  verification: {},
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  if (!isValidMerchantIdentifier(slug)) {
    return STORE_NOT_FOUND_METADATA;
  }

  // Keep metadata cacheable; request-bound validation stays in StorefrontLayoutContent.
  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    return STORE_NOT_FOUND_METADATA;
  }

  return buildStorefrontMerchantMetadata(merchant, slug);
}

/** Static viewport for Next.js 16+ PPR compatibility. */
export function generateViewport(): Viewport {
  return {
    width: 'device-width',
    initialScale: 1,
  };
}

async function resolveStorefrontLayoutTenant(
  params: Promise<{ slug: string }>
) {
  const isHomeRequestBeforeSlug = isStorefrontHomeRequest();
  const settledStateBox = isHomeRequestBeforeSlug
    ? getSettledCanonicalOgabasseyHomeStateBox(params)
    : null;
  const { slug } = await params;

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const appearance = resolveStorefrontAppearance(slug);

  const isCanonicalOgabasseyDomain = isOgabasseyCanonicalDomainSlug(slug);
  const isHomeRequest =
    isCanonicalOgabasseyDomain &&
    (isHomeRequestBeforeSlug || isStorefrontHomeRequest());
  if (!isHomeRequest) {
    clearSettledCanonicalOgabasseyHomeState();
  }
  const activeSettledStateBox = isHomeRequest
    ? (settledStateBox ?? getSettledCanonicalOgabasseyHomeStateBox(params))
    : null;
  const canonicalHomeHeroShellPromise = isHomeRequest
    ? resolveOgabasseyHomeHeroShell()
    : null;
  const canonicalHomeMerchantPromise = isHomeRequest
    ? settleCanonicalOgabasseyHomeMerchant(getRequestScopedMerchant(slug))
    : null;

  // Start the merchant read and, for the known OgaBassey home tenant, the
  // navigation read together: the merchant id is a committed constant, so
  // the categories fetch need not wait for merchant resolution. Same cache
  // key as the snapshot's own call, so a match dedupes to one fetch; the
  // snapshot revalidates the id before adopting the early result.
  const shellSnapshotBasePromise = getStorefrontShellSnapshotBase(slug);
  const eagerCategories = isOgabasseyHomeIdentifier(slug)
    ? {
        merchantId: OGABASSEY_MERCHANT_ID,
        categories: getStorefrontNavigationCategories(OGABASSEY_MERCHANT_ID),
      }
    : null;
  const shellSnapshotBase = await shellSnapshotBasePromise;

  if (!shellSnapshotBase) {
    notFound();
  }

  const isDevelopment = process.env.NODE_ENV === 'development';
  if (!shellSnapshotBase.merchant.is_published && !isDevelopment) {
    return {
      kind: 'unpublished' as const,
      appearance,
      businessName: shellSnapshotBase.merchant.business_name,
    };
  }

  const shellSnapshot = await getStorefrontShellSnapshot(
    shellSnapshotBase,
    eagerCategories
  );

  if (!shellSnapshot) {
    notFound();
  }

  if (isHomeRequest && activeSettledStateBox) {
    const [heroShell, resolvedMerchant] = await Promise.all([
      canonicalHomeHeroShellPromise,
      canonicalHomeMerchantPromise,
    ]);
    recordSettledCanonicalOgabasseyHomeState({
      box: activeSettledStateBox,
      heroShell: heroShell ?? null,
      merchant: resolvedMerchant ?? null,
      params,
      shareAcrossRequestTree: true,
      slug,
    });
  }

  return {
    kind: 'ready' as const,
    appearance,
    shellSnapshot,
  };
}

export async function StorefrontLayoutContent(props: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const resolution = await resolveStorefrontLayoutTenant(props.params);

  if (resolution.kind === 'unpublished') {
    const StoreNotPublished = await loadUnpublishedStorefront();

    return (
      <StorefrontThemeFrame appearance={resolution.appearance}>
        <StoreNotPublished businessName={resolution.businessName} />
      </StorefrontThemeFrame>
    );
  }

  return (
    <StorefrontThemeFrame appearance={resolution.appearance}>
      <StorefrontShellFrame
        // Page-level resource hints own LCP preloads. Keeping the shared
        // layout disabled prevents home hero hints from leaking onto nested routes.
        preloadHeroLcpImages={false}
        shellSnapshot={resolution.shellSnapshot}
      >
        {props.children}
      </StorefrontShellFrame>
    </StorefrontThemeFrame>
  );
}

async function StorefrontHeaderSlot({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isValidMerchantIdentifier(slug)) {
    return null;
  }

  const shellSnapshotBase = await getStorefrontShellSnapshotBase(slug);
  if (!shellSnapshotBase) {
    return null;
  }

  const isDevelopment = process.env.NODE_ENV === 'development';
  if (!shellSnapshotBase.merchant.is_published && !isDevelopment) {
    return null;
  }

  return (
    <StorefrontOgabasseyHeaderBridge
      merchant={shellSnapshotBase.merchant}
      routingMode={shellSnapshotBase.routingMode}
    />
  );
}

async function StorefrontLayoutDynamicBridge({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolution = await resolveStorefrontLayoutTenant(params);

  if (resolution.kind === 'unpublished') {
    const StoreNotPublished = await loadUnpublishedStorefront();

    return (
      <>
        <div data-storefront-unpublished-gate="" hidden />
        <StorefrontShellUnpublishedSync appearance={resolution.appearance} />
        <div data-storefront-unpublished-ssr-fallback="">
          <StoreNotPublished businessName={resolution.businessName} />
        </div>
      </>
    );
  }

  const experienceRoutes = await resolveBridgeExperienceRoutes(
    resolution.shellSnapshot.merchant
  );

  return (
    <>
      <StorefrontShellBridgeSync
        appearance={resolution.appearance}
        chatwootConfig={resolveBridgeChatwootConfig(
          resolution.shellSnapshot.merchant
        )}
        experienceRoutes={experienceRoutes}
        shellSnapshot={resolution.shellSnapshot}
      />
      <StorefrontBridgeHeadEffects shellSnapshot={resolution.shellSnapshot} />
    </>
  );
}

export default function StorefrontLayout(props: {
  children: React.ReactNode;
  fallbackAppearance?: StorefrontAppearance;
  loadingFallback?: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const {
    fallbackAppearance = DEFAULT_STOREFRONT_APPEARANCE,
    loadingFallback,
  } = props;
  // Undefined uses the shared conservative shell; explicit null opts out for
  // routes that intentionally need no static visual fallback.
  const fallbackContent =
    loadingFallback === undefined ? <ShellChromeLoading /> : loadingFallback;

  return (
    <>
      <StorefrontLcpCopyStyle />
      {/*
        Early ad-click attribution capture (PR-ATTR). Kept OUTSIDE the Suspense
        boundary so it lands in the PPR static shell / first-flush HTML for every
        storefront route and runs before hydration — independent of the dynamic
        tenant-resolution leg below. Cloudflare strips the middleware Set-Cookie on
        cached ad landings, so this client-side capture posts click IDs to
        `/api/attr`, which re-sets the cookie via HTTP.
      */}
      <AdAttributionCapture />
      {/*
        Render route children directly inside the static shell (never trapped
        behind `B:0` / hidden `S:0`), while header resolution and tenant shell
        hydration stream in sibling null-fallback Suspense slots so Next 16/PPR
        keeps metadata boundaries intact (E936-safe) and first-paint LCP heroes
        commit immediately.
      */}
      <StorefrontPprStaticShell
        appearance={fallbackAppearance}
        loadingFallback={fallbackContent}
      >
        <StorefrontClientShell
          dynamicSlot={
            <Suspense fallback={null}>
              <StorefrontLayoutDynamicBridge params={props.params} />
            </Suspense>
          }
          fallbackAppearance={fallbackAppearance}
          headerSlot={
            <Suspense fallback={null}>
              <StorefrontHeaderSlot params={props.params} />
            </Suspense>
          }
        >
          {props.children}
        </StorefrontClientShell>
      </StorefrontPprStaticShell>
    </>
  );
}
