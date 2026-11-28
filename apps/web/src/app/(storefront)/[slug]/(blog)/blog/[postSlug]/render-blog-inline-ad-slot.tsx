import type { ReactNode } from 'react';
import { DeferredAdUnit } from '@/components/storefront/ogabassey/components/deferred-ad-unit';

export function renderOgabasseyBlogInlineAdSlot(
  postId: string,
  enabled: boolean
): ReactNode | undefined {
  if (!enabled) {
    return undefined;
  }

  return (
    <DeferredAdUnit
      activateOnInteraction
      activateOnScroll
      placementKey="BLOG_SIDEBAR"
      slotInstance={`blog-post-inline-${postId}`}
      timeoutMs={0}
    />
  );
}
