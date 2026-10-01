import { describe, expect, it, vi } from 'vitest';
import { StorefrontPageContent } from './storefront-page-content';

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: () => '/',
  })),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

vi.mock('@/lib/validation', () => ({
  isValidMerchantIdentifier: vi.fn(() => false),
}));

describe('StorefrontPageContent', () => {
  it('throws notFound for invalid merchant identifiers', async () => {
    await expect(
      StorefrontPageContent({
        params: Promise.resolve({ slug: 'not a store' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
