import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderOgabasseyBlogInlineAdSlot } from './render-blog-inline-ad-slot';

vi.mock(
  '@/components/storefront/ogabassey/components/deferred-ad-unit',
  () => ({
    DeferredAdUnit: ({
      placementKey,
      slotInstance,
    }: {
      placementKey: string;
      slotInstance?: string;
    }) => (
      <div
        data-placement={placementKey}
        data-slot-instance={slotInstance}
        data-testid="inline-ad-unit"
      />
    ),
  })
);

describe('renderOgabasseyBlogInlineAdSlot', () => {
  it('returns undefined when disabled', () => {
    expect(renderOgabasseyBlogInlineAdSlot('post-3', false)).toBeUndefined();
  });

  it('returns a BLOG_SIDEBAR DeferredAdUnit scoped to the post id when enabled', () => {
    const slot = renderOgabasseyBlogInlineAdSlot('post-3', true);
    render(slot);

    const ad = screen.getByTestId('inline-ad-unit');
    expect(ad).toHaveAttribute('data-placement', 'BLOG_SIDEBAR');
    expect(ad).toHaveAttribute('data-slot-instance', 'blog-post-inline-post-3');
  });
});
