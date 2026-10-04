import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';

const { mockSearchPageContent } = vi.hoisted(() => ({
  mockSearchPageContent: vi.fn(() => <div>Search content</div>),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

const mockHeaders = vi.fn();
vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('./search-page-content', () => ({
  SearchPageContent: () => mockSearchPageContent(),
}));

const { default: SearchPage, generateMetadata } = await import('./page');

describe('storefront search page metadata', () => {
  it('defers search first paint to the route loader while the page content is pending', () => {
    mockSearchPageContent.mockImplementation(() => {
      throw new Promise(() => {
        // Keep the search page content suspended behind the local boundary.
      });
    });

    render(
      <Suspense fallback={<div>Route loader fallback</div>}>
        <SearchPage
          params={Promise.resolve({ slug: 'ogabassey' })}
          searchParams={Promise.resolve({})}
        />
      </Suspense>
    );

    expect(screen.getByText('Route loader fallback')).toBeInTheDocument();
    expect(screen.queryByText('Search content')).not.toBeInTheDocument();
  });

  it('emits noindex,follow metadata with a request-scoped canonical URL', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'shop.example.ng',
      business_name: 'Ogabassey',
      payout_currency: 'NGN',
    } as never);

    mockHeaders.mockResolvedValue(
      new Headers([
        ['host', 'proxy.internal'],
        ['x-custom-domain', 'shop.example.ng'],
        ['x-pathname', '/search'],
      ])
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ q: 'iphone 16' }),
    });

    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
    });
    expect(metadata.alternates).toMatchObject({
      canonical: 'https://shop.example.ng/search?q=iphone%2016',
    });
  });

  it('treats a repeated query as an empty search', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'shop.example.ng',
      business_name: 'Ogabassey',
      payout_currency: 'NGN',
    } as never);

    mockHeaders.mockResolvedValue(
      new Headers([
        ['host', 'proxy.internal'],
        ['x-custom-domain', 'shop.example.ng'],
        ['x-pathname', '/search'],
      ])
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ q: ['iphone', 'galaxy'] }),
    });

    expect(metadata.title).toEqual({ absolute: 'Search | Ogabassey' });
    expect(metadata.alternates).toMatchObject({
      canonical: 'https://shop.example.ng/search',
    });
  });

  it('treats a query that sanitizes to empty as an empty search', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'shop.example.ng',
      business_name: 'Ogabassey',
      payout_currency: 'NGN',
    } as never);

    mockHeaders.mockResolvedValue(
      new Headers([
        ['host', 'proxy.internal'],
        ['x-custom-domain', 'shop.example.ng'],
        ['x-pathname', '/search'],
      ])
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ q: '< >' }),
    });

    expect(metadata.title).toEqual({ absolute: 'Search | Ogabassey' });
    expect(metadata.alternates).toMatchObject({
      canonical: 'https://shop.example.ng/search',
    });
  });
});
