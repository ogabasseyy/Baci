import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AdAttributionCapture } from '@/components/storefront/ad-attribution-capture';
import {
  DEFAULT_STOREFRONT_APPEARANCE,
  getStorefrontAppearanceClasses,
} from '@/components/storefront/storefront-appearance';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { generateMetadata as homeMetadata } from '../[slug]/(home)/page';
import {
  StorefrontLayoutContent,
  generateMetadata as storefrontMetadata,
} from '../[slug]/layout';
import { OgabasseyHomeCriticalShell } from '../ogabassey/ogabassey-home-critical-shell';
import { OgabasseyHomeHeroPreloadLink } from '../ogabassey/ogabassey-home-hero-preload-link';
import { resolveOgabasseyHomeHeroShell } from '../ogabassey/ogabassey-home-hero-shell-data';
import { PublishedOgabasseyHomePageContent } from '../ogabassey/ogabassey-home-page-content';
import { OgabasseyHomeStaticShellHead } from '../ogabassey/ogabassey-home-static-shell-head';
import { OgabasseyStaticResourceHints } from '../ogabassey/ogabassey-static-resource-hints';
import { StorefrontLcpCopyStyle } from '../storefront-lcp-copy-style';

export { generateViewport } from '../[slug]/layout';

/** Canonical home only: pass resolved data directly, rather than coordinating
 * independent RSC children through mutable settled-state boxes. Nested routes
 * retain [slug]'s shell and never await the home feed. */
export default async function CanonicalOgabasseyHomePage() {
  const params = Promise.resolve({ slug: 'ogabassey.com' });
  const [merchant, shell] = await Promise.all([
    getRequestScopedMerchant('ogabassey.com'),
    resolveOgabasseyHomeHeroShell(),
  ]);
  if (!merchant) notFound();
  const authorizedShell =
    merchant.is_published === true &&
    shell?.status === 'published' &&
    shell.merchantId === merchant.id
      ? shell
      : null;
  const first = authorizedShell?.slides[0];
  const content = await StorefrontLayoutContent({
    params,
    children: (
      <>
        <OgabasseyStaticResourceHints />
        <OgabasseyHomeStaticShellHead />
        <OgabasseyHomeCriticalShell />
        {first && <OgabasseyHomeHeroPreloadLink src={first.imageUrl} />}
        {merchant.is_published && (
          <PublishedOgabasseyHomePageContent
            merchant={merchant}
            omitDocumentHeading
            omitMobileCarousel={false}
            resolvedPathPrefix=""
            shellMerchantId={authorizedShell?.merchantId ?? null}
            shellSlides={authorizedShell?.slides ?? null}
          />
        )}
      </>
    ),
  });
  return (
    <>
      <StorefrontLcpCopyStyle />
      <AdAttributionCapture />
      <div
        className={`storefront-ppr-static-shell ${getStorefrontAppearanceClasses(DEFAULT_STOREFRONT_APPEARANCE).join(' ')}`}
        data-storefront-shell=""
      >
        <div className="storefront-ppr-static-shell__content">{content}</div>
      </div>
    </>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const params = Promise.resolve({ slug: 'ogabassey.com' });
  const [base, home] = await Promise.all([
    storefrontMetadata({ params }),
    homeMetadata({ params }),
  ]);
  return { ...base, ...home };
}
