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
      <OgabasseyStaticHomePageContent
        omitCommittedHero
        pathPrefix={pathPrefix}
      />
    </>
  );
}
