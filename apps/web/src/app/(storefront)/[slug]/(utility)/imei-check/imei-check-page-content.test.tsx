import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedMerchant } from '@/lib/cached-data';
import { ImeiCheckPageContent } from './imei-check-page-content';

vi.mock('@/components/storefront/ogabassey/pages/imei-checker', () => ({
  OgabasseyImeiChecker: () => <div>IMEI checker UI</div>,
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

const { ImeiCheckResolvedContent } = await import('./page');

describe('ImeiCheckPageContent', () => {
  beforeEach(() => {
    vi.mocked(getCachedMerchant).mockReset();
    notFound.mockClear();
  });

  it('renders crawler-visible verification guidance', () => {
    render(<ImeiCheckPageContent />);

    expect(
      screen.getByRole('heading', {
        name: 'What to confirm before running an IMEI check',
      })
    ).toBeInTheDocument();
  });

  it('throws notFound when the merchant is missing', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue(null);

    await expect(
      ImeiCheckResolvedContent({ params: Promise.resolve({ slug: 'missing' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
