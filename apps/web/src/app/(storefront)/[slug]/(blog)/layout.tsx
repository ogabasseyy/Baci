import type { ReactNode } from 'react';
import { StorefrontBlogStyleLoader } from '@/app/(storefront)/storefront-blog-style-loader';
import { isOgabasseyStaticTenant } from '../ogabassey-static-params';

// Match utility routes: the parent [slug] request boundary otherwise hides
// leaf loading.tsx during instant static-shell validation, so /blog paints
// "Loading storefront chrome" instead of the featured LCP image.
export const unstable_instant = false;

// Next.js layouts do not receive searchParams and do not rerender on query
// navigation (https://nextjs.org/docs/app/api-reference/file-conventions/layout).
// Static OgaBassey tenants therefore defer CSS here only for the unfiltered
// first page. Filtered listing variants (`?search=`, `?category=`, `?page=`)
// eager-import StorefrontEagerBlogCssLayout from BlogListingQueryContent,
// which already awaits the page searchParams inside Suspense.
export default async function StorefrontBlogCssLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (isOgabasseyStaticTenant(slug)) {
    return (
      <>
        <StorefrontBlogStyleLoader />
        {children}
      </>
    );
  }

  const { StorefrontEagerBlogCssLayout } = await import(
    '@/app/(storefront)/storefront-eager-blog-css-layout'
  );

  return (
    <StorefrontEagerBlogCssLayout>{children}</StorefrontEagerBlogCssLayout>
  );
}
