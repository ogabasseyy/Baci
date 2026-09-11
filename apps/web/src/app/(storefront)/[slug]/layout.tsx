import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type React from 'react';
import { ShellChromeLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { StorefrontLcpCopyStyle } from '@/app/(storefront)/storefront-lcp-copy-style';
import { AdAttributionCapture } from '@/components/storefront/ad-attribution-capture';
import {
  DEFAULT_STOREFRONT_APPEARANCE,
  resolveStorefrontAppearance,
  type StorefrontAppearance,
} from '@/components/storefront/storefront-appearance';
import { loadUnpublishedStorefront } from '@/components/storefront/unpublished-storefront';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import { mergeStorefrontSmartAppBannerOther } from '@/lib/storefront-smart-app-banner-metadata';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { getStorefrontSeoDescription } from './seo-helpers';
import { StorefrontPprStaticShell } from './storefront-ppr-static-shell';
import { StorefrontShellFrame } from './storefront-shell-frame';
import {
  getStorefrontShellSnapshot,
  getStorefrontShellSnapshotBase,
} from './storefront-shell-snapshot';
import { StorefrontThemeFrame } from './storefront-theme-frame';

// Run storefront SSR next to the Supabase primary (AWS eu-west-1 / Dublin) so
// every render's DB round-trips stay intra-region. Neither `vercel.json`
// `regions` nor the project's serverlessFunctionRegion is honored for Next.js
// App Router functions — `preferredRegion` is the only mechanism the framework
// builder bakes into the function config. Inherited by storefront PAGE routes;
// route handlers + sibling layouts export it individually.
export const preferredRegion = 'dub1';

const STORE_NOT_FOUND_METADATA: Metadata = {
  title: 'Store Not Found',
  // Replace root metadata alternates so noindex fallback pages do not inherit a canonical.
  alternates: null,
  robots: {
    index: false,
    follow: true,
  },
  // Replace root verification so the platform `google-adsense-account` meta does
  // not bleed onto not-found pages served on third-party custom domains.
  verification: {},
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  // Validate identifier format
  if (!isValidMerchantIdentifier(slug)) {
    return STORE_NOT_FOUND_METADATA;
  }

  // Keep metadata cacheable. Request-bound storefront validation belongs in
  // StorefrontLayoutContent so Next's metadata boundary cannot displace PDP slots.
  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    return STORE_NOT_FOUND_METADATA;
  }

  // Extract verification code from feature settings or published config.
  // feature_settings is normalized in cached-data; published_config is optional.
  const featureSettings = merchant.feature_settings;
  const publishedConfig = merchant.published_config;

  const rawVerification =
    featureSettings?.google_site_verification ||
    publishedConfig?.google_site_verification;
  const verificationCode =
    typeof rawVerification === 'string' ? rawVerification : undefined;

  // Build icons configuration for merchant favicon
  // Fall back to logo_url if no dedicated favicon exists
  const faviconSvg = merchant.favicon_svg_url;
  const faviconPng32 = merchant.favicon_png_32_url;
  const faviconAppleTouch = merchant.favicon_apple_touch_url;

  // Build icons array only if merchant has custom favicons
  const icons =
    faviconSvg || faviconPng32 || faviconAppleTouch
      ? {
          icon: [
            ...(faviconSvg ? [{ url: faviconSvg, type: 'image/svg+xml' }] : []),
            ...(faviconPng32
              ? [{ url: faviconPng32, sizes: '32x32', type: 'image/png' }]
              : []),
          ].filter(Boolean),
          apple: faviconAppleTouch
            ? [{ url: faviconAppleTouch, sizes: '180x180', type: 'image/png' }]
            : undefined,
        }
      : merchant.logo_url
        ? {
            icon: [{ url: merchant.logo_url }],
            apple: [{ url: merchant.logo_url }],
          }
        : undefined;

  // Build SEO-friendly description with proper fallbacks
  const description = getStorefrontSeoDescription(merchant);
  const baseUrl = buildStoreUrl(merchant);
  let metadataBase: URL | undefined;

  try {
    metadataBase = baseUrl ? new URL(baseUrl) : undefined;
  } catch {
    metadataBase = undefined;
  }

  const other = mergeStorefrontSmartAppBannerOther(slug);

  return {
    metadataBase,
    description,
    icons,
    // Always emit an explicit verification object so the platform-level
    // `google-adsense-account` meta from the root layout never bleeds onto
    // merchant storefronts — especially independent third-party custom domains
    // (merchant sovereignty). The platform AdSense tag stays scoped to the
    // usebaci.com apex, which is served by the root layout. A merchant's own
    // Google Search Console code is still applied here when configured.
    verification: {
      google: verificationCode,
    },
    openGraph: {
      title: merchant.site_title || merchant.business_name,
      description,
      images: merchant.logo_url ? [merchant.logo_url] : [],
    },
    // Apple Smart App Banner — prompts iOS Safari users to open/install the app
    ...(other ? { other } : {}),
    // Disable platform manifest for merchant stores to prevent Baci branding leakage
    manifest: null,
  };
}

/**
 * Next.js 16+ Viewport Configuration
 * 2026 Best Practice: Static viewport for PPR compatibility
 * Dynamic theme colors are applied via meta tag in the layout component
 */
export function generateViewport(): Viewport {
  return {
    width: 'device-width',
    initialScale: 1,
  };
}

export async function StorefrontLayoutContent(props: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const appearance = resolveStorefrontAppearance(slug);

  const shellSnapshotBase = await getStorefrontShellSnapshotBase(slug);

  if (!shellSnapshotBase) {
    notFound();
  }

  const isDevelopment = process.env.NODE_ENV === 'development';
  if (!shellSnapshotBase.merchant.is_published && !isDevelopment) {
    const StoreNotPublished = await loadUnpublishedStorefront();

    return (
      <StorefrontThemeFrame appearance={appearance}>
        <StoreNotPublished
          businessName={shellSnapshotBase.merchant.business_name}
        />
      </StorefrontThemeFrame>
    );
  }

  const shellSnapshot = await getStorefrontShellSnapshot(shellSnapshotBase);

  if (!shellSnapshot) {
    notFound();
  }

  return (
    <StorefrontThemeFrame appearance={appearance}>
      <StorefrontShellFrame
        // Page-level resource hints own LCP preloads. Keeping the shared
        // layout disabled prevents home hero hints from leaking onto nested routes.
        preloadHeroLcpImages={false}
        shellSnapshot={shellSnapshot}
      >
        {props.children}
      </StorefrontShellFrame>
    </StorefrontThemeFrame>
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
        Keep params and tenant reads inside the null Suspense resume slot so
        the neutral shell can be prerendered before dynamic params resolve.
        Next 16.2/PPR can resume Googlebot's blocking metadata boundary into
        the dynamic slot when that slot owns a visible fallback, so the visual
        shell remains a static sibling instead.
      */}
      <StorefrontPprStaticShell
        appearance={fallbackAppearance}
        loadingFallback={fallbackContent}
      >
        <StorefrontLayoutContent params={props.params}>
          {props.children}
        </StorefrontLayoutContent>
      </StorefrontPprStaticShell>
    </>
  );
}
