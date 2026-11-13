import { headers } from 'next/headers';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { OgabasseyBlackFridayPage } from '@/app/(storefront)/ogabassey/ogabassey-black-friday-page';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { isPublishedOgabassey } from '@/lib/ogabassey-black-friday';
import { resolveMerchantContextIdentifier } from '@/lib/storefront-route-identifier';
import { isDomainIdentifier } from '@/lib/validation';
import CategoryPage, {
  generateMetadata as generateCategoryMetadata,
} from '../(catalog)/(listing)/[category]/page';

export const unstable_instant = false;

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function asCategoryProps(props: PageProps) {
  return {
    ...props,
    params: props.params.then(({ slug }) => ({
      slug,
      category: 'black-friday',
    })),
  };
}

export function generateMetadata(props: PageProps) {
  return generateCategoryMetadata(asCategoryProps(props));
}

async function BlackFridayRuntime(props: PageProps) {
  await connection();
  const { slug } = await props.params;
  const merchant = await getRequestScopedMerchant(slug);
  if (!isPublishedOgabassey(merchant)) {
    return <CategoryPage {...asCategoryProps(props)} />;
  }

  const context = resolveMerchantContextIdentifier(await headers());
  const pathPrefix = context || isDomainIdentifier(slug) ? '' : `/${slug}`;
  return (
    <OgabasseyBlackFridayPage
      pathPrefix={pathPrefix}
      filters={props.searchParams}
    />
  );
}

export default function BlackFridayPage(props: PageProps) {
  return (
    <Suspense fallback={null}>
      <BlackFridayRuntime {...props} />
    </Suspense>
  );
}
