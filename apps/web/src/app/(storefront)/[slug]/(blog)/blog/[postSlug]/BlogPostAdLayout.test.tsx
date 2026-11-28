import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyBlogPostAdLayout } from './BlogPostAdLayout';

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
        data-testid="rail-ad-unit"
      />
    ),
  })
);

describe('OgabasseyBlogPostAdLayout', () => {
  it('renders children directly without a sidebar rail when disabled', () => {
    render(
      <OgabasseyBlogPostAdLayout enabled={false} postId="post-1">
        <p>Article copy</p>
      </OgabasseyBlogPostAdLayout>
    );

    expect(screen.getByText('Article copy')).toBeInTheDocument();
    expect(screen.queryByTestId('rail-ad-unit')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: /sponsored sidebar/i })
    ).not.toBeInTheDocument();
  });

  it('renders a guaranteed 300px desktop sticky rail when enabled', () => {
    render(
      <OgabasseyBlogPostAdLayout enabled postId="post-42">
        <p>Article copy</p>
      </OgabasseyBlogPostAdLayout>
    );

    expect(screen.getByText('Article copy')).toBeInTheDocument();
    const sidebar = screen.getByRole('complementary', {
      name: /sponsored sidebar/i,
    });
    expect(sidebar).toHaveClass('hidden', 'w-[300px]', 'lg:block');
    expect(sidebar.parentElement).toHaveClass(
      'lg:grid-cols-[minmax(0,1fr)_300px]'
    );

    const ad = screen.getByTestId('rail-ad-unit');
    expect(ad).toHaveAttribute('data-placement', 'SIDEBAR_HALF_PAGE');
    expect(ad).toHaveAttribute('data-slot-instance', 'blog-post-rail-post-42');
  });
});
