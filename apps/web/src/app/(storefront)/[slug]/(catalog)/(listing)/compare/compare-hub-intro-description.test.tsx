import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { CompareHubIntroDescription } from './compare-hub-intro-description';

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

describe('CompareHubIntroDescription', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
  });

  it('streams the merchant-specific compare intro copy', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      business_name: 'Ogabassey',
    } as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    render(
      await CompareHubIntroDescription({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByText(/Browse Ogabassey product comparison pages by category/)
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-compare-hub-intro-resolved]')
    ).not.toBeNull();
  });

  it('renders nothing when the merchant name is missing', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      business_name: '  ',
    } as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const ui = await CompareHubIntroDescription({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(ui).toBeNull();
  });

  it('renders nothing for an invalid merchant identifier', async () => {
    const ui = await CompareHubIntroDescription({
      params: Promise.resolve({ slug: 'not a store' }),
    });

    expect(ui).toBeNull();
    expect(getRequestScopedMerchant).not.toHaveBeenCalled();
  });
});
