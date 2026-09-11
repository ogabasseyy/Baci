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
 * not wait on Tailwind `text-3xl` / `text-lg` utilities. The 100svh shell is
 * not a link — only the 400px frame is — and the snapshot title stays a
 * paragraph so it cannot precede the streamed page H1.
 *
 * Do not paint the snapshot excerpt here. Catalog naira in that sentence sits
 * in the first viewport, and the extra block grows the LCP text cluster on
 * Slow-4G. Title plus date is enough unique copy for the committed frame.
 */
export function BlogListingOgabasseyLcpHero() {
  if (!ogabasseyBlogLcpSnapshot) {
    return <BlogFeaturedStoryFrame />;
  }

  const { basePath, featuredPost, publishedDateLabel } =
    ogabasseyBlogLcpSnapshot;

  return (
    <div className="ogabassey-blog-lcp-hero">
      <div className="ogabassey-blog-lcp-hero__inner">
        <Link
          className="ogabassey-blog-lcp-hero__frame"
          href={asRoute(
            joinRouteBasePath(basePath, `/blog/${featuredPost.slug}`)
          )}
        >
          <div className="ogabassey-blog-featured-story__media" />
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
