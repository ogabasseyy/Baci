import Link from 'next/link';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import {
  BLOG_HERO_IMAGE_QUALITY,
  BLOG_LISTING_FEATURED_IMAGE_SIZES,
} from '@/components/storefront/ogabassey/config/blog-media';
import { asRoute, joinRouteBasePath } from '@/lib/routes';
import { BlogFeaturedStoryFrame } from './blog-featured-story-frame';
import { preloadBlogListingFeaturedImage } from './blog-listing-featured-image-preload';
import { ogabasseyBlogLcpSnapshot } from './ogabassey-blog-lcp-snapshot';

/**
 * Committed LCP hero for the Ogabassey blog listing shell.
 *
 * Renders the snapshot featured image (`<picture>` with AVIF `<source>` +
 * transformed CDN `<img>` fallback via `CdnFormatImage`) and preloads the
 * byte-identical AVIF `srcSet` in the initial server HTML shell without waiting
 * on `searchParams`, listing fetches, or client hydration.
 *
 * Listing `hideFeaturedStory` keeps skipping the streamed duplicate hero in
 * `OgabasseyV2Blog` on the unfiltered root view so the featured story and its
 * image are never rendered or downloaded twice.
 *
 * Geometry and scrim rules live in `storefront-lcp-copy-css.ts` and
 * `storefront-blog.css` semantic selectors so image sizing, overlay contrast,
 * and typography do not wait on deferred Tailwind chunks.
 */
export function BlogListingOgabasseyLcpHero() {
  if (!ogabasseyBlogLcpSnapshot) {
    return <BlogFeaturedStoryFrame />;
  }

  const { basePath, featuredPost, imageSrc, publishedDateLabel } =
    ogabasseyBlogLcpSnapshot;

  preloadBlogListingFeaturedImage(imageSrc);

  return (
    <div className="ogabassey-blog-lcp-hero">
      <div className="ogabassey-blog-lcp-hero__inner">
        <Link
          className="ogabassey-blog-lcp-hero__frame group"
          href={asRoute(
            joinRouteBasePath(basePath, `/blog/${featuredPost.slug}`)
          )}
        >
          <div className="ogabassey-blog-featured-story__media">
            <CdnFormatImage
              alt=""
              className="object-cover opacity-90 transition-transform duration-1000 group-hover:scale-105"
              fetchPriority="high"
              fill
              loading="eager"
              quality={BLOG_HERO_IMAGE_QUALITY}
              sizes={BLOG_LISTING_FEATURED_IMAGE_SIZES}
              src={imageSrc}
            />
            <div className="ogabassey-blog-featured-story__scrim" />
          </div>
          <div className="ogabassey-blog-lcp-hero__copy">
            <p
              className="ogabassey-blog-featured-story__title"
              data-cwv-lcp-copy="blog"
            >
              {featuredPost.title}
            </p>
            <time
              className="ogabassey-blog-featured-story__date"
              dateTime={featuredPost.published_at}
            >
              {publishedDateLabel}
            </time>
          </div>
        </Link>
      </div>
    </div>
  );
}
