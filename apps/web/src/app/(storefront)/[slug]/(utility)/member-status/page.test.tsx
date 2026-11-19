import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedMerchant } from '@/lib/cached-data';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { mockMerchant } from '@/lib/cached-data.test-utils';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';

vi.mock('@/components/storefront/ogabassey/pages/member-status', () => ({
  OgabasseyV2MemberStatus: () => (
    <div data-testid="member-status-ui">Member Status UI</div>
  ),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(),
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: vi.fn(),
  isValidMerchantIdentifier: vi.fn(),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

const { default: MemberStatusPage, metadata } = await import('./page');

const baseMerchant: CachedMerchant = {
  ...mockMerchant,
  slug: 'ogabassey',
  template_id: 'ogabassey',
};

describe('MemberStatusPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isValidMerchantIdentifier).mockReturnValue(true);
    vi.mocked(isDomainIdentifier).mockReturnValue(false);
  });

  it('declares noindex robots in metadata', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toBe('Member Status');
  });

  it('renders member status UI for ogabassey merchant slug', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue(baseMerchant);

    render(
      await MemberStatusPage({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByTestId('member-status-ui')).toBeInTheDocument();
    expect(getCachedMerchant).toHaveBeenCalledWith('ogabassey');
  });

  it('resolves merchant by domain when slug is domain identifier', async () => {
    vi.mocked(isDomainIdentifier).mockReturnValue(true);
    vi.mocked(getCachedMerchantByDomain).mockResolvedValue(baseMerchant);

    render(
      await MemberStatusPage({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    expect(screen.getByTestId('member-status-ui')).toBeInTheDocument();
    expect(getCachedMerchantByDomain).toHaveBeenCalledWith('ogabassey.com');
  });

  it('calls notFound when slug is invalid merchant identifier', async () => {
    vi.mocked(isValidMerchantIdentifier).mockReturnValue(false);

    await expect(
      MemberStatusPage({
        params: Promise.resolve({ slug: 'invalid!slug' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('calls notFound when merchant template is not ogabassey', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      ...baseMerchant,
      slug: 'other',
      template_id: 'default',
    });

    await expect(
      MemberStatusPage({
        params: Promise.resolve({ slug: 'other' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('calls notFound when merchant is null', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue(null);

    await expect(
      MemberStatusPage({
        params: Promise.resolve({ slug: 'missing' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
