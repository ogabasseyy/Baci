/**
 * Committed blog listing LCP frame geometry, scrim, and typography rules,
 * interpolated into STOREFRONT_LCP_COPY_CSS.
 *
 * Keeps image sizing, overlay contrast, and typography stable in the initial
 * HTML shell without waiting on deferred Tailwind chunks.
 */
export const BLOG_LISTING_LCP_CSS = `
/*
  Blog listing LCP frame. storefront-blog.css is deferred so this geometry must
  live on the shared render-blocking sheet or the 400px/500px frame collapses
  until the Tailwind chunk arrives and restyles LCP.
*/
.ogabassey-blog-lcp-hero {
  background: var(--store-background, #f9fafb);
  padding: 2rem 1rem 0;
}

.ogabassey-blog-lcp-hero__inner {
  margin-left: auto;
  margin-right: auto;
  max-width: 1400px;
}

.ogabassey-blog-lcp-hero__frame {
  border-radius: 2rem;
  color: inherit;
  display: block;
  height: 400px;
  margin-bottom: 0;
  overflow: hidden;
  position: relative;
  text-decoration: none;
}

.ogabassey-blog-lcp-hero__copy {
  bottom: 0;
  left: 0;
  padding: 2rem;
  position: absolute;
  width: 100%;
}

.ogabassey-blog-featured-story__media {
  background: var(--ogabassey-blog-featured-scrim, rgb(17 24 39));
  inset: 0;
  position: absolute;
}

.ogabassey-blog-featured-story__media img {
  height: 100%;
  object-fit: cover;
  opacity: 0.9;
  width: 100%;
}

.ogabassey-blog-featured-story__scrim {
  background: linear-gradient(
    to top,
    var(--ogabassey-blog-featured-scrim, rgb(17 24 39)) 0%,
    color-mix(
      in srgb,
      var(--ogabassey-blog-featured-scrim, rgb(17 24 39)) 72%,
      transparent
    ) 42%,
    transparent 100%
  );
  inset: 0;
  position: absolute;
}

.ogabassey-blog-featured-story__title,
.ogabassey-blog-featured-story__description,
.ogabassey-blog-featured-story__date {
  color: var(--ogabassey-blog-featured-text, #ffffff);
  text-shadow: 0 2px 18px rgb(0 0 0 / 45%);
}

.ogabassey-blog-featured-story__title {
  display: -webkit-box;
  font-size: 1.875rem;
  font-weight: 900;
  -webkit-line-clamp: 3;
  line-height: 1;
  margin-bottom: 1rem;
  overflow: hidden;
  -webkit-box-orient: vertical;
}

.ogabassey-blog-featured-story__description {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  max-width: 42rem;
  opacity: 0.82;
  overflow: hidden;
  -webkit-box-orient: vertical;
}

.ogabassey-blog-featured-story__date {
  font-size: 0.875rem;
  opacity: 0.82;
}

@media (min-width: 768px) {
  .ogabassey-blog-lcp-hero {
    padding: 3rem 1.5rem 0;
  }

  .ogabassey-blog-lcp-hero__frame {
    height: 500px;
  }

  .ogabassey-blog-lcp-hero__copy {
    padding: 3rem;
    width: 75%;
  }
}

@media (min-width: 1024px) {
  .ogabassey-blog-lcp-hero__copy {
    width: 66.666667%;
  }
}
`;
