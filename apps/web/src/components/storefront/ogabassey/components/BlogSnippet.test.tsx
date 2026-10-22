import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNot = vi.fn();
const mockLimit = vi.fn();
const mockExplicitLinkLimit = vi.fn();
const mockExplicitLinkNot = vi.fn();
const mockProductMaybeSingle = vi.fn();
const mockRpc = vi.fn();
const mockLcpWindow = vi.fn<() => Promise<void>>();
vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: () => mockLcpWindow(),
}));
const EXPECTED_FALLBACK_FILTER_CALLS = 2;
const blogQuery = {
  eq: vi.fn(() => blogQuery),
  ilike: vi.fn(() => blogQuery),
  limit: mockLimit,
  not: mockNot,
  order: vi.fn(() => blogQuery),
  select: vi.fn(() => blogQuery),
};
const productQuery = {
  eq: vi.fn(() => productQuery),
  maybeSingle: mockProductMaybeSingle,
  select: vi.fn(() => productQuery),
};
const explicitLinkQuery = {
  eq: vi.fn(() => explicitLinkQuery),
  limit: mockExplicitLinkLimit,
  not: mockExplicitLinkNot,
  order: vi.fn(() => explicitLinkQuery),
  select: vi.fn(() => explicitLinkQuery),
};

mockNot.mockReturnValue(blogQuery);
mockLimit.mockResolvedValue({ data: [], error: null });

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ basePath: '/ogabassey' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    rpc: mockRpc,
    from: (table: string) => {
      if (table === 'blog_post_products') {
        return explicitLinkQuery;
      }
      if (table === 'blog_posts') {
        return blogQuery;
      }
      if (table === 'products') {
        return productQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    },
  })),
}));

vi.mock('next/image', () => ({
  default: () => null,
}));

// Featured images now render through CdnFormatImage (explicit per-format
// <picture>); mirror the next/image double so these tests keep asserting
// snippet content, not image internals.
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: () => null,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { BlogSnippet } from '@/components/storefront/ogabassey/components/BlogSnippet';
import { createClient } from '@/lib/supabase/client';

describe('BlogSnippet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLcpWindow.mockResolvedValue(undefined);
    mockNot.mockReturnValue(blogQuery);
    mockLimit.mockResolvedValue({ data: [], error: null });
    mockExplicitLinkLimit.mockResolvedValue({ data: [], error: null });
    mockExplicitLinkNot.mockReturnValue(explicitLinkQuery);
    mockProductMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockRpc.mockResolvedValue({ data: [], error: null });
  });

  it('keeps the below-fold database client out of the pending LCP window', async () => {
    const gate = Promise.withResolvers<void>();
    mockLcpWindow.mockReturnValue(gate.promise);
    render(<BlogSnippet category="Smartphones" merchantId="merchant-1" />);
    await waitFor(() => expect(mockLcpWindow).toHaveBeenCalledOnce());
    expect(createClient).not.toHaveBeenCalled();
    gate.resolve();
    await waitFor(() => expect(createClient).toHaveBeenCalledOnce());
  });

  it('does not load the database client if navigation unmounts the pending snippet', async () => {
    const gate = Promise.withResolvers<void>();
    mockLcpWindow.mockReturnValue(gate.promise);
    const { unmount } = render(
      <BlogSnippet category="Smartphones" merchantId="merchant-1" />
    );
    await waitFor(() => expect(mockLcpWindow).toHaveBeenCalledOnce());
    unmount();
    gate.resolve();
    await Promise.resolve();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('excludes fallback blog posts without a published_at timestamp and renders no snippet when none exists', async () => {
    render(<BlogSnippet category="Smartphones" merchantId="merchant-1" />);

    await waitFor(() =>
      expect(mockLimit).toHaveBeenCalledTimes(EXPECTED_FALLBACK_FILTER_CALLS)
    );

    expect(mockNot).toHaveBeenCalledWith('published_at', 'is', null);
    expect(mockNot).toHaveBeenCalledTimes(EXPECTED_FALLBACK_FILTER_CALLS);
    expect(
      screen.queryByRole('heading', { name: /from the blog/i })
    ).not.toBeInTheDocument();
  });

  it('renders no snippet when the category blog query fails', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockLimit
      .mockResolvedValueOnce({ data: [], error: new Error('query failed') })
      .mockResolvedValueOnce({ data: [], error: null });

    try {
      render(<BlogSnippet category="Smartphones" merchantId="merchant-1" />);

      await waitFor(() =>
        expect(mockLimit).toHaveBeenCalledTimes(EXPECTED_FALLBACK_FILTER_CALLS)
      );

      expect(mockNot).toHaveBeenCalledWith('published_at', 'is', null);
      expect(mockNot).toHaveBeenCalledTimes(EXPECTED_FALLBACK_FILTER_CALLS);
      expect(
        screen.queryByRole('heading', { name: /from the blog/i })
      ).not.toBeInTheDocument();
      expect(errorSpy).toHaveBeenCalledWith(
        'Error fetching category blog snippet:',
        expect.any(Error)
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('falls back without logging an error when the product embedding row is missing', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockProductMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    try {
      render(
        <BlogSnippet
          category="Smartphones"
          merchantId="merchant-1"
          productId="missing-product"
        />
      );

      await waitFor(() =>
        expect(mockLimit).toHaveBeenCalledTimes(EXPECTED_FALLBACK_FILTER_CALLS)
      );

      expect(mockProductMaybeSingle).toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalledWith(
        'Error fetching product embedding for blog snippet:',
        expect.anything()
      );
      expect(
        screen.queryByRole('heading', { name: /from the blog/i })
      ).not.toBeInTheDocument();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('renders the related blog snippet when a published post is found', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [
        {
          id: 'post-1',
          title: 'Best Smartphones in 2026',
          slug: 'best-smartphones-2026',
          excerpt: 'Top picks for this year.',
          featured_image_url:
            'https://cdn.example.com/storage/v1/object/public/media/merchant-1/blog/cover.png',
          category: 'Smartphones',
          reading_time_minutes: 5,
        },
      ],
      error: null,
    });

    render(<BlogSnippet category="Smartphones" merchantId="merchant-1" />);

    await screen.findByRole('heading', { name: /from the blog/i });
    expect(
      screen.getByRole('heading', { name: /best smartphones in 2026/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /read full article/i })
    ).toHaveAttribute('href', '/ogabassey/blog/best-smartphones-2026');
  });

  it('prefers explicit product blog links before semantic matching', async () => {
    mockExplicitLinkLimit.mockResolvedValueOnce({
      data: [
        {
          product_id: 'product-1',
          blog_post_id: 'post-1',
          relationship: 'primary',
          blog_posts: {
            id: 'post-1',
            title: 'iPhone 13 Buying Guide',
            slug: 'iphone-13-buying-guide',
            excerpt: 'Useful buyer guide.',
            featured_image_url:
              'https://cdn.ogabassey.com/image/format=auto/core-assets/blog/codex/run/hero.jpg',
            category: 'Buying Guides',
            reading_time_minutes: 4,
          },
        },
      ],
      error: null,
    });

    render(
      <BlogSnippet
        category="Smartphones"
        merchantId="merchant-1"
        productId="product-1"
      />
    );

    expect(
      await screen.findByRole('heading', { name: /from the blog/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /iphone 13 buying guide/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /read full article/i })
    ).toHaveAttribute('href', '/ogabassey/blog/iphone-13-buying-guide');
    expect(explicitLinkQuery.eq).toHaveBeenCalledWith(
      'blog_posts.status',
      'published'
    );
    expect(mockExplicitLinkNot).toHaveBeenCalledWith(
      'blog_posts.published_at',
      'is',
      null
    );
    expect(mockProductMaybeSingle).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('falls back to semantic matching when explicit product blog link lookup fails', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockExplicitLinkLimit.mockResolvedValueOnce({
      data: [],
      error: new Error('link lookup failed'),
    });
    mockProductMaybeSingle.mockResolvedValueOnce({
      data: { content_embedding: [0.1, 0.2] },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: 'post-2',
          title: 'Best Smartphones in 2026',
          slug: 'best-smartphones-2026',
          excerpt: 'Top picks.',
          featured_image_url: null,
          category: 'Smartphones',
          reading_time_minutes: 5,
        },
      ],
      error: null,
    });

    try {
      render(
        <BlogSnippet
          category="Smartphones"
          merchantId="merchant-1"
          productId="product-1"
        />
      );

      expect(
        await screen.findByRole('heading', {
          name: /best smartphones in 2026/i,
        })
      ).toBeInTheDocument();
      expect(errorSpy).toHaveBeenCalledWith(
        'Error fetching explicit product blog link:',
        expect.any(Error)
      );
      expect(mockRpc).toHaveBeenCalledWith(
        'match_blog_to_product',
        expect.anything()
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
