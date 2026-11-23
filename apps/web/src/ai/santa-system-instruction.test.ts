import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCachedSantaProducts: vi.fn(),
}));

vi.mock('./santa-data', () => ({
  getCachedSantaProducts: mocks.getCachedSantaProducts,
}));

import {
  generateSantaPrompt,
  SANTA_CATALOG_TIMEOUT_MS,
} from './santa-system-instruction';

const tenant = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  merchantSlug: 'ogabassey',
  businessName: 'Ogabassey',
  currencyCode: 'NGN',
  priceNegotiationEnabled: true,
  agenticCheckoutEnabled: true,
} as const;

describe('generateSantaPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('embeds the fetched catalog data and strict price authority rules', async () => {
    mocks.getCachedSantaProducts.mockResolvedValue(
      '- Demo Phone X | Price: NGN 100,000 | Max Discount: 10%'
    );
    const prompt = await generateSantaPrompt(tenant, SANTA_CATALOG_TIMEOUT_MS);
    expect(prompt).toContain('Demo Phone X');
    expect(prompt).toContain('<product-catalog-data>');
    expect(prompt).toContain('ACTION:ADD_TO_CART|PRODUCT:');
  });

  it('fails closed without ACTION permission when catalog lookup fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getCachedSantaProducts.mockRejectedValue(new Error('db down'));
    const prompt = await generateSantaPrompt(tenant, SANTA_CATALOG_TIMEOUT_MS);
    errors.mockRestore();
    expect(prompt).toContain('temporarily unavailable');
    expect(prompt).toContain('do not emit any ACTION:ADD_TO_CART lines');
  });
});
