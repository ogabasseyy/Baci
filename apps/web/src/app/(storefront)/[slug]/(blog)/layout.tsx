import type { ReactNode } from 'react';
import { StorefrontBlogStyleLoader } from '@/app/(storefront)/storefront-blog-style-loader';

// Match utility routes: the parent [slug] request boundary otherwise hides
// leaf loading.tsx during instant static-shell validation, so /blog paints
// "Loading storefront chrome" instead of the featured LCP copy.
export const unstable_instant = false;

// Next.js layouts do not receive searchParams and do not rerender on query
// navigation (https://nextjs.org/docs/app/api-reference/file-conventions/layout).
// Do not import the eager blog-css layout from this file or from listing
// query content — Next would emit that sheet as render-blocking on the
// unfiltered /blog LCP path. Filtered listings hide the snapshot hero with
// data-blog-listing-filtered and load blog CSS after first input.
export default function StorefrontBlogCssLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <StorefrontBlogStyleLoader />
      {children}
    </>
  );
}
