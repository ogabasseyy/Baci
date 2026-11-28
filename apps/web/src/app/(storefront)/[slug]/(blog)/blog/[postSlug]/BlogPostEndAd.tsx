import { DeferredAdUnit } from '@/components/storefront/ogabassey/components/deferred-ad-unit';

interface OgabasseyBlogEndAdProps {
  enabled: boolean;
  postId: string;
}

/**
 * Post-prose `300x250` (`BLOG_SIDEBAR`) unit rendered after the article body.
 * Uses `-mx-6 sm:mx-0` to reclaim the article card's mobile padding and hides
 * below `340px` (`340 - 32 main px-4 = 308px >= 300px`) so the `300px` creative
 * fits without horizontal clipping in both mobile and two-column desktop tracks.
 */
export function OgabasseyBlogEndAd({
  enabled,
  postId,
}: OgabasseyBlogEndAdProps) {
  if (!enabled) {
    return null;
  }

  return (
    <div className="-mx-6 mb-8 hidden justify-center min-[340px]:flex sm:mx-0">
      <DeferredAdUnit
        activateOnInteraction
        activateOnScroll
        placementKey="BLOG_SIDEBAR"
        slotInstance={`blog-post-end-${postId}`}
        timeoutMs={0}
      />
    </div>
  );
}
