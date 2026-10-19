import { Suspense } from 'react';
import { OgabasseyHomeHeroReserveFallback } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-reserve-fallback';
import { peekSettledCanonicalOgabasseyHomeState } from '@/app/(storefront)/ogabassey/ogabassey-home-settled-state';
import { OgabasseyHomeStaticShellHead } from '@/app/(storefront)/ogabassey/ogabassey-home-static-shell-head';
import { OgabasseyStaticHomePageContent } from '@/app/(storefront)/ogabassey/ogabassey-static-home-page-content';
import { OgabasseyStaticResourceHints } from '@/app/(storefront)/ogabassey/ogabassey-static-resource-hints';

export function OgabasseyStaticHomePage({
  pathPrefix,
}: {
  pathPrefix: string;
}) {
  const settledHeroShell =
    pathPrefix === '' &&
    peekSettledCanonicalOgabasseyHomeState()?.heroShellSettled === true;

  return (
    <>
      <OgabasseyStaticResourceHints />
      <OgabasseyHomeStaticShellHead />
      {/*
        The reserve lives outside the async content: that component awaits
        the hero-shell lookup before it returns its own inner Suspense, so
        when the lookup is cold or slow the route's fallback={null} would
        otherwise reserve no hero geometry and the streamed hero would
        shift layout. When the canonical hero shell has already settled for
        this request, render the content directly so React Fizz does not spawn
        an extra lazy Suspense task that defers the hero behind the reserve.
      */}
      {settledHeroShell ? (
        <OgabasseyStaticHomePageContent
          omitCommittedHero
          pathPrefix={pathPrefix}
        />
      ) : (
        <Suspense fallback={<OgabasseyHomeHeroReserveFallback />}>
          <OgabasseyStaticHomePageContent
            omitCommittedHero
            pathPrefix={pathPrefix}
          />
        </Suspense>
      )}
    </>
  );
}
