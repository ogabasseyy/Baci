/**
 * Inline critical CSS for individual blog post LCP elements.
 * storefront-blog-post.css is loaded additively, so aspect-ratio, geometry,
 * border-radius, and title typography must live on the shared render-blocking
 * sheet to reserve the 16:9 hero space and lock first-paint typography before
 * external CSS arrives.
 */
export const BLOG_POST_LCP_CSS = `
[data-cwv-lcp-copy="blog-post"] {
  font-family: "Inter Fallback", Arial, Helvetica, sans-serif !important;
  font-size: 1.875rem !important;
  font-weight: 700 !important;
  line-height: 2.25rem !important;
  margin: 0 0 1rem !important;
}

@media (min-width: 768px) {
  [data-cwv-lcp-copy="blog-post"] {
    font-size: 2.25rem !important;
    line-height: 2.5rem !important;
  }
}

.ogabassey-blog-post-hero-frame {
  aspect-ratio: 16 / 9;
  border-radius: 1rem;
  margin-bottom: 2rem;
  overflow: hidden;
  position: relative;
}
`;
