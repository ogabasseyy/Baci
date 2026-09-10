import { Suspense } from 'react';
import { JsonLd } from '@/components/seo/json-ld';
import {
  OGABASSEY_DESCRIPTION,
  OGABASSEY_HOME_URL,
  OGABASSEY_SOCIAL_IMAGE_URL,
  OGABASSEY_TITLE,
} from '@/config/ogabassey';
import { resolveOgabasseyHomeHeroShell } from './ogabassey-home-hero-shell-data';
import { OgabasseyHomePageContent } from './ogabassey-home-page-content';
import { OgabasseyHomeStyleLoader } from './ogabassey-home-style-loader';
import { OgabasseyPublicationSafeHeroFallback } from './ogabassey-publication-safe-hero-fallback';

interface OgabasseyStaticHomePageContentProps {
  /** Static per-route prefix for request-streamed storefront links: '' for the
   *  apex domain and '/ogabassey' for the path route. */
  pathPrefix: string;
  /** Set when the parent page already committed the brand-text LCP sibling. */
  omitCommittedHero?: boolean;
}

const ogabasseyStaticHomepageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: OGABASSEY_TITLE,
  description: OGABASSEY_DESCRIPTION,
  url: OGABASSEY_HOME_URL,
  isPartOf: {
    '@type': 'WebSite',
    name: 'OgaBassey',
    url: OGABASSEY_HOME_URL,
  },
  primaryImageOfPage: {
    '@type': 'ImageObject',
    url: OGABASSEY_SOCIAL_IMAGE_URL,
  },
} as const;

export async function OgabasseyStaticHomePageContent({
  omitCommittedHero = false,
  pathPrefix,
}: OgabasseyStaticHomePageContentProps) {
  // Cached-only lookup (never request APIs — those stay in the dynamic
  // subtree). Slides are inert data here: only the request-scoped subtree may
  // turn them into shopping UI after it confirms the current publication
  // state. The committed mobile hero is a Suspense sibling (blog listing
  // pattern): text LCP in the static shell, no CDN preload racing CSS. The
  // streamed Hero keeps the mobile carousel below that 100svh shell so launch
  // products remain shoppable without occupying the first paint. Brand copy
  // only in the committed slot — no product names, prices, links, or controls.
  const heroShell = await resolveOgabasseyHomeHeroShell();
  const shellSlides =
    heroShell?.status === 'published' ? heroShell.slides : null;
  const shellMerchantId =
    heroShell?.status === 'published' ? heroShell.merchantId : null;
  const committedMobileLcpUrl = shellSlides?.[0]?.imageUrl ?? null;
  const paintCommittedHero =
    Boolean(committedMobileLcpUrl) && !omitCommittedHero;

  return (
    <>
      <JsonLd data={ogabasseyStaticHomepageSchema} />
      <OgabasseyHomeStyleLoader />
      {paintCommittedHero && committedMobileLcpUrl ? (
        <>
          <div data-ogabassey-home-lcp-shell="true">
            <OgabasseyPublicationSafeHeroFallback
              heroImageUrl={committedMobileLcpUrl}
            />
          </div>
          <p className="ogabassey-home-unique-copy">{OGABASSEY_DESCRIPTION}</p>
          <Suspense fallback={null}>
            <OgabasseyHomePageContent
              pathPrefix={pathPrefix}
              shellMerchantId={shellMerchantId}
              shellSlides={shellSlides}
            />
          </Suspense>
        </>
      ) : (
        <Suspense fallback={null}>
          <OgabasseyHomePageContent
            pathPrefix={pathPrefix}
            shellMerchantId={shellMerchantId}
            shellSlides={shellSlides}
          />
        </Suspense>
      )}
    </>
  );
}
