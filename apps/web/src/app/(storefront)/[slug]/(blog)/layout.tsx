import type { ReactNode } from 'react';
import { StorefrontBlogStyleLoader } from '@/app/(storefront)/storefront-blog-style-loader';

// Match utility routes: the parent [slug] request boundary otherwise hides
// leaf loading.tsx during instant static-shell validation, so /blog paints
// "Loading storefront chrome" instead of the featured LCP image.
export const unstable_instant = false;

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
