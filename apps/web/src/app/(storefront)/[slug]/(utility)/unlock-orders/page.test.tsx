import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM } from '@/config/storefront-metadata-cache-bots';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { isDomainIdentifier } from '@/lib/validation';

vi.mock('@/components/storefront/ogabassey/pages/unlock-orders', () => ({
  OgabasseyUnlockOrders: () => <div>Unlock order tracker</div>,
}));
vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(async () => null),
}));
vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: vi.fn((value: string) => value.includes('.')),
  isValidMerchantIdentifier: vi.fn(() => true),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn(async () => null),
}));
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  redirect: (path: string) => redirect(path),
}));

const { default: UnlockOrdersPage, metadata } = await import('./page');

describe('UnlockOrdersPage', () => {
  beforeEach(() => {
    vi.mocked(getCachedMerchant).mockReset();
    vi.mocked(getCachedMerchantByDomain).mockReset();
    vi.mocked(getCurrentSlugForAlias).mockReset().mockResolvedValue(null);
    vi.mocked(isDomainIdentifier).mockImplementation((value) =>
      value.includes('.')
    );
  });

  it('renders only for the supported merchant template', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      template_id: 'ogabassey',
    } as never);

    render(
      await UnlockOrdersPage({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByText('Unlock order tracker')).toBeInTheDocument();
    expect(metadata.robots).toEqual({ follow: false, index: false });
  });

  it('redirects a non-Ogabassey custom-domain retired slug to the store home', async () => {
    vi.mocked(isDomainIdentifier).mockReturnValue(true);
    vi.mocked(getCachedMerchantByDomain).mockResolvedValue({
      slug: 'zorvexa',
      template_id: 'classic',
    } as never);
    vi.mocked(getCurrentSlugForAlias).mockResolvedValue('zorvexa');

    await expect(
      UnlockOrdersPage({
        params: Promise.resolve({ slug: 'shop.example' }),
        searchParams: Promise.resolve({
          campaign: 'summer',
          [STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM]: 'metadata-blocking',
          tag: ['one', 'two'],
        }),
      })
    ).rejects.toThrow('NEXT_REDIRECT:/?campaign=summer&tag=one&tag=two');
    expect(getCurrentSlugForAlias).toHaveBeenCalledWith('unlock-orders');
  });
});
