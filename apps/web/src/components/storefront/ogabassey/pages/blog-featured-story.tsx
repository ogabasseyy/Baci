import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import {
  BLOG_HERO_IMAGE_QUALITY,
  BLOG_LISTING_FEATURED_IMAGE_SIZES,
} from '@/components/storefront/ogabassey/config/blog-media';
import { asRoute, joinRouteBasePath } from '@/lib/routes';
import type { BlogPostData } from '@/templates/registry';

interface BlogFeaturedStoryProps {
  basePath: string;
  featuredPost: BlogPostData;
  imageSrc: string;
  publishedDateLabel: string;
}

/**
 * Resolves the full route path for a blog post link within a store base path.
 */
function blogPostHref(basePath: string, slug: string): string {
  return joinRouteBasePath(basePath, `/blog/${slug}`);
}

/**
 * Featured story hero card for the Ogabassey storefront blog listing.
 *
 * Renders an optimized per-format `<picture>` via `CdnFormatImage` using
 * responsive `BLOG_LISTING_FEATURED_IMAGE_SIZES` to ensure candidate parity
 * with early server preload hints.
 */
export function BlogFeaturedStory({
  basePath,
  featuredPost,
  imageSrc,
  publishedDateLabel,
}: BlogFeaturedStoryProps) {
  return (
    <Link
      href={asRoute(blogPostHref(basePath, featuredPost.slug))}
      className="group relative mb-12 block h-[400px] overflow-hidden rounded-4xl shadow-2xl transition-all hover:shadow-[0_20px_50px_rgba(0,0,0,0.15)] md:h-[500px]"
    >
      <div className="ogabassey-blog-featured-story__media absolute inset-0">
        {/* Explicit per-format `<picture>` (AVIF `<source>` + jpeg/png `<img>`
            fallback) for the blog listing LCP hero. Cloudflare Free ignores
            `Vary: Accept`, so a single `format=auto` URL would hand non-AVIF
            browsers undecodable bytes. The paired preload
            (`preloadBlogListingFeaturedImage`) owns the byte-identical AVIF
            hint, so this render does NOT fire its own. Non-CDN merchant heroes
            have no AVIF twin and render as a plain `<img>`. */}
        <CdnFormatImage
          src={imageSrc}
          alt=""
          className="object-cover opacity-90 transition-transform duration-1000 group-hover:scale-105"
          fill
          fetchPriority="high"
          loading="eager"
          sizes={BLOG_LISTING_FEATURED_IMAGE_SIZES}
          quality={BLOG_HERO_IMAGE_QUALITY}
        />
        <div className="ogabassey-blog-featured-story__scrim absolute inset-0" />
      </div>
      <div className="absolute bottom-0 left-0 w-full p-8 md:w-3/4 md:p-12 lg:w-2/3">
        <div className="mb-4 flex items-center gap-3">
          <span className="rounded bg-store-primary px-3 py-1.5 font-black text-[10px] text-store-primary-text uppercase tracking-widest shadow-sm md:text-xs">
            Featured Story
          </span>
          {featuredPost.category && (
            <span className="ogabassey-blog-featured-story__meta-pill rounded border px-2 py-1 font-bold text-xs uppercase tracking-wider backdrop-blur-xs">
              {featuredPost.category}
            </span>
          )}
        </div>
        <h2 className="ogabassey-blog-featured-story__title mb-4 font-black text-3xl leading-none transition-colors md:text-5xl lg:text-6xl">
          {featuredPost.title}
        </h2>
        <p className="ogabassey-blog-featured-story__description mb-6 max-w-2xl text-lg leading-relaxed line-clamp-2 md:text-xl">
          {featuredPost.excerpt}
        </p>
        <div className="ogabassey-blog-featured-story__text flex items-center gap-4 font-medium">
          <span className="ogabassey-blog-featured-story__cta flex items-center gap-2 border-b pb-0.5 transition-all duration-300 group-hover:gap-4">
            Read Article <ArrowRight size={20} />
          </span>
          <span className="ogabassey-blog-featured-story__separator">•</span>
          <time className="ogabassey-blog-featured-story__date text-sm" dateTime={featuredPost.published_at}>
            {publishedDateLabel}
          </time>
        </div>
      </div>
    </Link>
  );
}
