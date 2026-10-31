import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';

vi.mock('@/components/storefront/ogabassey/pages/member-status', () => ({
  OgabasseyV2MemberStatus: () => <div data-testid="member-status-ui" />,
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(),
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: vi.fn(() => false),
  isValidMerchantIdentifier: vi.fn(() => true),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

const { default: MemberStatusPage, metadata } = await import('./page');

type CachedMerchantResult = Awaited<ReturnType<typeof getCachedMerchant>>;

describe('MemberStatusPage', () => {
  beforeEach(() => {
    vi.mocked(isValidMerchantIdentifier).mockReturnValue(true);
    vi.mocked(isDomainIdentifier).mockReturnValue(false);
  });

  it('leaves the merchant suffix to the storefront title template', () => {
    // Regression: a hardcoded "| Ogabassey" doubled up once the storefront
    // layout began appending the merchant name to every relative title.
    expect(metadata.title).toBe('Member Status');
  });

  it('renders for the Ogabassey store resolved by slug', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      template_id: 'ogabassey',
    } as unknown as CachedMerchantResult);

    render(
      await MemberStatusPage({ params: Promise.resolve({ slug: 'OgaBassey' }) })
    );

    expect(screen.getByTestId('member-status-ui')).toBeInTheDocument();
    expect(getCachedMerchant).toHaveBeenCalledWith('ogabassey');
  });

  it('resolves custom domains through the domain lookup', async () => {
    vi.mocked(isDomainIdentifier).mockReturnValue(true);
    vi.mocked(getCachedMerchantByDomain).mockResolvedValue({
      template_id: 'ogabassey',
    } as unknown as CachedMerchantResult);

    render(
      await MemberStatusPage({
        params: Promise.resolve({ slug: 'Shop.Example.com' }),
      })
    );

    expect(getCachedMerchantByDomain).toHaveBeenCalledWith('shop.example.com');
  });

  it('returns notFound for invalid identifiers and non-Ogabassey stores', async () => {
    vi.mocked(isValidMerchantIdentifier).mockReturnValue(false);
    await expect(
      MemberStatusPage({ params: Promise.resolve({ slug: 'bad!!slug' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    vi.mocked(isValidMerchantIdentifier).mockReturnValue(true);
    vi.mocked(getCachedMerchant).mockResolvedValue({
      template_id: 'default',
    } as unknown as CachedMerchantResult);
    await expect(
      MemberStatusPage({ params: Promise.resolve({ slug: 'other' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
