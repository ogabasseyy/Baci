import { BlogFeaturedStoryFrame } from './blog-featured-story-frame';

interface BlogListingFallbackProps {
  includeFeaturedSkeleton?: boolean;
}

export function BlogListingFallback({
  includeFeaturedSkeleton = false,
}: BlogListingFallbackProps) {
  return (
    <div
      role="status"
      aria-label="Loading blog posts"
      aria-live="polite"
      className="px-4 py-8 text-sm text-store-background-text"
    >
      {includeFeaturedSkeleton ? (
        <section
          aria-label="Loading featured story"
          data-blog-featured-skeleton=""
        >
          <BlogFeaturedStoryFrame />
        </section>
      ) : null}
      Loading blog posts
    </div>
  );
}
