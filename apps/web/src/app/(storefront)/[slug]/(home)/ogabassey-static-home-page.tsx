import { Suspense } from 'react';
import { OgabasseyHomeHeroReserveFallback } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-reserve-fallback';
import { OgabasseyStaticHomePageContent } from '@/app/(storefront)/ogabassey/ogabassey-static-home-page-content';
import { OgabasseyStaticResourceHints } from '@/app/(storefront)/ogabassey/ogabassey-static-resource-hints';

export function OgabasseyStaticHomePage({
  pathPrefix,
}: {
  pathPrefix: string;
}) {
  return (
    <>
      <OgabasseyStaticResourceHints />
      {/*
        The reserve lives outside the async content: that component awaits
        the hero-shell lookup before it returns its own inner Suspense, so
        when the lookup is cold or slow the route's fallback={null} would
        otherwise reserve no hero geometry and the streamed hero would
        shift layout. This boundary streams the reserve immediately while
        the lookup resolves beneath it.
      */}
      <Suspense fallback={<OgabasseyHomeHeroReserveFallback />}>
        <OgabasseyStaticHomePageContent
          omitCommittedHero
          pathPrefix={pathPrefix}
        />
      </Suspense>
    </>
  );
}
