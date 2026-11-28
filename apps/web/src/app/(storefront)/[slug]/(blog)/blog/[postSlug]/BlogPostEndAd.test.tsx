import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyBlogEndAd } from './BlogPostEndAd';

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
        data-testid="end-ad-unit"
      />
    ),
  })
);

describe('OgabasseyBlogEndAd', () => {
  it('renders nothing when disabled', () => {
    const { container } = render(
      <OgabasseyBlogEndAd enabled={false} postId="post-7" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders a 300x250 BLOG_SIDEBAR slot guarded for >=340px viewports when enabled', () => {
    render(<OgabasseyBlogEndAd enabled postId="post-7" />);

    const ad = screen.getByTestId('end-ad-unit');
    expect(ad).toHaveAttribute('data-placement', 'BLOG_SIDEBAR');
    expect(ad).toHaveAttribute('data-slot-instance', 'blog-post-end-post-7');
    expect(ad.parentElement).toHaveClass(
      '-mx-6',
      'hidden',
      'min-[340px]:flex',
      'sm:mx-0'
    );
  });
});
