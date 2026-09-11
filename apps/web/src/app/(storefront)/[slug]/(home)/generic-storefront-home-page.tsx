import { StorefrontEagerFullCssLayout } from '@/app/(storefront)/storefront-eager-full-css-layout';
import { StorefrontPageContent } from '../storefront-page-content';

export function GenericStorefrontHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <StorefrontEagerFullCssLayout>
      <StorefrontPageContent params={params} />
    </StorefrontEagerFullCssLayout>
  );
}
