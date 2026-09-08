import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedMerchant } from '@/lib/cached-data';

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

const { ImeiCheckPageContent } = await import('./imei-check-page-content');

describe('ImeiCheckPageContent', () => {
  beforeEach(() => {
    vi.mocked(getCachedMerchant).mockReset();
    notFound.mockClear();
  });

  it('throws notFound when the merchant is missing', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue(null);

    await expect(
      ImeiCheckPageContent({ params: Promise.resolve({ slug: 'missing' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
