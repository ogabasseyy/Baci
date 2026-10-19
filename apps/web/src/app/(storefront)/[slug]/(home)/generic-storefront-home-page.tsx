import { StorefrontFullStyleLoader } from '@/app/(storefront)/storefront-full-style-loader';
import { StorefrontPageContent } from '../storefront-page-content';

export function GenericStorefrontHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <>
      <StorefrontFullStyleLoader />
      <StorefrontPageContent params={params} />
    </>
  );
}
