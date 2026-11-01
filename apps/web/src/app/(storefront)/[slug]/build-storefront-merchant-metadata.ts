import type { Metadata } from 'next';
import type { getRequestScopedMerchant } from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import { mergeStorefrontSmartAppBannerOther } from '@/lib/storefront-smart-app-banner-metadata';
import { getStorefrontSeoDescription } from './seo-helpers';

type StorefrontLayoutMerchant = NonNullable<
  Awaited<ReturnType<typeof getRequestScopedMerchant>>
>;

/**
 * Builds the storefront layout's merchant-level metadata: canonical isolation,
 * verification, favicons, Open Graph, the smart app banner, and a title
 * template that brands child pages with the merchant rather than the
 * platform's root `%s | Baci` template.
 */
export function buildStorefrontMerchantMetadata(
  merchant: StorefrontLayoutMerchant,
  slug: string
): Metadata {
  // Extract verification code from feature settings or published config.
  const featureSettings = merchant.feature_settings;
  const publishedConfig = merchant.published_config;

  const rawVerification =
    featureSettings?.google_site_verification ||
    publishedConfig?.google_site_verification;
  const verificationCode =
    typeof rawVerification === 'string' ? rawVerification : undefined;

  // Build icons configuration for merchant favicon (fallback to logo_url).
  const faviconSvg = merchant.favicon_svg_url;
  const faviconPng32 = merchant.favicon_png_32_url;
  const faviconAppleTouch = merchant.favicon_apple_touch_url;

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
    // Brand child-page titles with the merchant, not the platform: without a
    // storefront template, relative titles ('Cart') inherit the root
    // `%s | Baci` template. The fallback must be `absolute`: Next resolves a
    // `default` against the parent's template, so it would still end in
    // `| Baci` on pages without their own title.
    title: {
      absolute: merchant.site_title || merchant.business_name,
      template: `%s | ${merchant.business_name}`,
    },
    description,
    icons,
    // Replace root metadata alternates so storefront pages never inherit the platform canonical.
    alternates: null,
    applicationName: merchant.business_name,
    authors: [{ name: merchant.business_name }],
    // Emit explicit verification so platform-level google-adsense-account meta never bleeds onto merchant storefronts.
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
