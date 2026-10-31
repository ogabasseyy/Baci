import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/storefront/ogabassey/pages/quiz', () => ({
  OgabasseyV2Quiz: () => null,
}));
vi.mock('@/components/storefront/ogabassey/pages/reviews', () => ({
  OgabasseyV2Reviews: () => null,
}));
vi.mock('@/components/storefront/ogabassey/pages/member-status', () => ({
  OgabasseyV2MemberStatus: () => null,
}));
vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(),
}));

describe('bugfix: utility page titles doubled the merchant name', () => {
  it.each([
    ['./quiz/page', 'Super Quiz'],
    ['./reviews/page', 'My Reviews'],
    ['./member-status/page', 'Member Status'],
  ])('%s leaves the merchant suffix to the storefront template', async (path, title) => {
    const { metadata } = await import(path);

    expect(metadata.title).toBe(title);
  });
});
