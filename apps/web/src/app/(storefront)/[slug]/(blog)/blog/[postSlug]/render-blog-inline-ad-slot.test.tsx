import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderOgabasseyBlogInlineAdSlot } from './render-blog-inline-ad-slot';

vi.mock(
  '@/components/storefront/ogabassey/components/deferred-ad-unit',
  () => ({
    DeferredAdUnit: ({
      activateOnIdle,
      activateOnInteraction,
      activateOnScroll,
      placementKey,
      slotInstance,
      timeoutMs,
    }: {
      activateOnIdle?: boolean;
      activateOnInteraction?: boolean;
      activateOnScroll?: boolean;
      placementKey: string;
      slotInstance?: string;
      timeoutMs?: number;
    }) => (
      <div
        data-activate-on-idle={String(Boolean(activateOnIdle))}
        data-activate-on-interaction={String(Boolean(activateOnInteraction))}
        data-activate-on-scroll={String(Boolean(activateOnScroll))}
        data-placement={placementKey}
        data-slot-instance={slotInstance}
        data-testid="inline-ad-unit"
        data-timeout-ms={String(timeoutMs)}
      />
    ),
  })
);

describe('renderOgabasseyBlogInlineAdSlot', () => {
  it('returns undefined when disabled', () => {
    expect(renderOgabasseyBlogInlineAdSlot('post-3', false)).toBeUndefined();
  });

  it('returns an interaction-gated BLOG_SIDEBAR DeferredAdUnit when enabled', () => {
    const slot = renderOgabasseyBlogInlineAdSlot('post-3', true);
    render(slot);

    const ad = screen.getByTestId('inline-ad-unit');
    expect(ad).toHaveAttribute('data-placement', 'BLOG_SIDEBAR');
    expect(ad).toHaveAttribute('data-slot-instance', 'blog-post-inline-post-3');
    expect(ad).toHaveAttribute('data-activate-on-idle', 'false');
    expect(ad).toHaveAttribute('data-activate-on-interaction', 'true');
    expect(ad).toHaveAttribute('data-activate-on-scroll', 'true');
    expect(ad).toHaveAttribute('data-timeout-ms', '0');
  });
});
