import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedMerchant } from '@/lib/cached-data';

vi.mock('@/components/storefront/ogabassey/pages/swap', () => ({
  OgabasseyV2Swap: () => <div>Swap UI</div>,
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(async () => null),
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

const { default: SwapPage, metadata } = await import('./page');

describe('SwapPage', () => {
  beforeEach(() => {
    vi.mocked(getCachedMerchant).mockReset();
    notFound.mockClear();
  });

  it('renders swap UI with crawler-visible preparation guidance', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      template_id: 'ogabassey',
      slug: 'ogabassey',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    render(
      await SwapPage({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByText('Swap UI')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'How to prepare your device for swap',
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/exact model, storage size/i)).toBeInTheDocument();
  });

  it('uses a service-focused meta description', () => {
    expect(metadata.description).toContain('eligible phone, laptop');
  });

  it('throws notFound for non-ogabassey templates', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      template_id: 'default',
      slug: 'demo-store',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    await expect(
      SwapPage({ params: Promise.resolve({ slug: 'demo-store' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
