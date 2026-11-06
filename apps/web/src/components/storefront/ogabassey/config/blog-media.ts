/**
 * Shared image-weight configuration for OgaBassey blog LCP surfaces.
 *
 * The blog listing "featured story" hero and the blog post hero are both the
 * Largest Contentful Paint on their pages. DebugBear measured the listing hero
 * (1200px, q75) at ~4.9s loadDuration on Slow-4G, so a single low quality knob
 * governs every blog hero/card image to keep the transferred bytes small
 * without the visible artifacts a lower value would introduce at hero scale.
 *
 * This constant MUST stay in the `qualities` allowlist in `next.config.ts`
 * (currently [35, 50, 60, 70, 75, 80, 85, 90, 100]) — an off-list value makes
 * next/image throw at build.
 */
export const BLOG_HERO_IMAGE_QUALITY = 50;

/**
 * `sizes` for the blog post hero. It spans the article column with container
 * margins at every breakpoint (article container has px-6/px-8 and maxes out
 * at max-w-6xl = 1152px with md:px-12 = 1056px inner hero cap), so on mobile
 * (<768px) it takes `calc(100vw - 80px)` and tablet takes `calc(100vw - 112px)`
 * up to the 1056px desktop cap. On 390px mobile (2x DPR = 620 physical px),
 * this selects 640w instead of 828w, reducing mobile hero download bytes by 28%.
 * On 1x DPR desktop it selects 1080w instead of 1200w without visual artifacting.
 * Keep this aligned with the preload hint so the browser selects the same
 * responsive candidate it discovers early.
 */
export const BLOG_POST_HERO_IMAGE_SIZES =
  '(max-width: 768px) calc(100vw - 80px), (max-width: 1200px) calc(100vw - 112px), 1056px';

/**
 * Fallback preload width for the blog post hero. `sizes` still drives the
 * browser's final candidate selection via `imageSrcSet`; this only sets the
 * positional `href` React emits for the preload link.
 */
export const BLOG_POST_HERO_IMAGE_PRELOAD_WIDTH = 1200;

/**
 * Responsive `sizes` for the blog listing featured-story hero.
 *
 * Matches the hero frame geometry (.ogabassey-blog-lcp-hero):
 * - Mobile (<768px): 1rem padding per side -> calc(100vw - 2rem)
 * - Tablet/Desktop (768px - 1440px): 1.5rem padding per side -> calc(100vw - 3rem)
 * - Desktop (>1440px): max-width container capped at 1400px
 *
 * On 390px mobile (3x DPR = 1074 physical px), this selects 1080w instead of
 * 1200w, reducing download bytes on Slow-4G without visible artifacting.
 */
export const BLOG_LISTING_FEATURED_IMAGE_SIZES =
  '(max-width: 767px) calc(100vw - 2rem), (max-width: 1440px) calc(100vw - 3rem), 1400px';

/** Fallback preload width for the blog listing featured-story hero. */
export const BLOG_LISTING_FEATURED_IMAGE_PRELOAD_WIDTH = 750;

/** Responsive `sizes` for blog listing cards (1/2/3 columns as width grows). */
export const BLOG_LISTING_CARD_IMAGE_SIZES =
  '(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw';
