import type { ReactNode } from 'react';
import { DeferredAdUnit } from '@/components/storefront/ogabassey/components/deferred-ad-unit';

interface OgabasseyBlogPostAdLayoutProps {
  children: ReactNode;
  enabled: boolean;
  postId: string;
}

/**
 * Two-column desktop layout for OgaBassey blog articles that guarantees a full
 * `300px` right rail track (`lg:grid-cols-[minmax(0,1fr)_300px]`) whenever the
 * sticky `SIDEBAR_HALF_PAGE` ad is visible, preventing narrower viewports from
 * clipping `300px` creatives. Non-OgaBassey tenants render `children` directly.
 */
export function OgabasseyBlogPostAdLayout({
  children,
  enabled,
  postId,
}: OgabasseyBlogPostAdLayoutProps) {
  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8 xl:gap-10">
      <div className="min-w-0">{children}</div>
      <aside
        aria-label="Sponsored sidebar"
        className="hidden w-[300px] lg:block"
      >
        <div className="sticky top-24">
          <DeferredAdUnit
            activateOnInteraction
            activateOnScroll
            placementKey="SIDEBAR_HALF_PAGE"
            slotInstance={`blog-post-rail-${postId}`}
            timeoutMs={0}
          />
        </div>
      </aside>
    </div>
  );
}
