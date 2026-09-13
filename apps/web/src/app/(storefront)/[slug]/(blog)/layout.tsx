import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-blog.css';
import type { ReactNode } from 'react';

// Match utility routes: the parent [slug] request boundary otherwise hides
// leaf loading.tsx during instant static-shell validation, so /blog paints
// "Loading storefront chrome" instead of the featured LCP copy.
export const unstable_instant = false;

// Next.js layouts do not receive searchParams and do not rerender on query
// navigation (https://nextjs.org/docs/app/api-reference/file-conventions/layout).
// Both filtered and unfiltered listings need their scoped styles on first
// paint. Waiting for input leaves passive visitors with unstyled content.
export default function StorefrontBlogCssLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
