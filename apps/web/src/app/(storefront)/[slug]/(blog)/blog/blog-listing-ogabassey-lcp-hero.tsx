import Link from 'next/link';
import { asRoute, joinRouteBasePath } from '@/lib/routes';
import { BlogFeaturedStoryFrame } from './blog-featured-story-frame';
import { ogabasseyBlogLcpSnapshot } from './ogabassey-blog-lcp-snapshot';

/**
 * Text LCP hero for the Ogabassey listing shell.
 *
 * A 400px CDN `<img>` in this slot is discoverable and tiny (~12KB) but still
 * owns Slow-4G simulated LCP (~7s) because it is the largest painted element.
 * Compare already lands ~4s as committed text. Keep the featured frame so CLS
 * stays stable, but paint the snapshot title — no network image — so LCP can
 * match that text path. Listing `hideFeaturedStory` must keep skipping the
 * `CdnFormatImage` picture or that later image becomes LCP again.
 *
 * Geometry lives in storefront-blog.css semantic selectors so LCP size does
 * not wait on Tailwind `text-3xl` / `text-lg` utilities.
 */
export function BlogListingOgabasseyLcpHero() {
  if (!ogabasseyBlogLcpSnapshot) {
    return <BlogFeaturedStoryFrame />;
  }

  const { basePath, featuredPost, publishedDateLabel } =
    ogabasseyBlogLcpSnapshot;

  return (
    <Link
      className="ogabassey-blog-lcp-hero"
      href={asRoute(joinRouteBasePath(basePath, `/blog/${featuredPost.slug}`))}
    >
      <div className="ogabassey-blog-lcp-hero__inner">
        <div className="ogabassey-blog-lcp-hero__frame">
          <div className="ogabassey-blog-featured-story__media" />
          <div className="ogabassey-blog-lcp-hero__copy">
            <h2
              className="ogabassey-blog-featured-story__title"
              data-cwv-lcp-copy="blog"
            >
              {featuredPost.title}
            </h2>
            {featuredPost.excerpt ? (
              <p className="ogabassey-blog-featured-story__description">
                {featuredPost.excerpt}
              </p>
            ) : null}
            <time
              className="ogabassey-blog-featured-story__date"
              dateTime={featuredPost.published_at}
            >
              {publishedDateLabel}
            </time>
          </div>
        </div>
      </div>
    </Link>
  );
}
