import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ categories: vi.fn(), products: vi.fn() }));
vi.mock('./fast-catalog-data', () => ({
  loadFastCatalogCategories: mocks.categories,
  loadFastCatalogProducts: mocks.products,
}));

import { tryFastCatalogChat } from './fast-catalog-flow';

const tenant = {
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  businessName: 'Ogabassey',
  currencyCode: 'NGN',
  agenticCheckoutEnabled: true,
  priceNegotiationEnabled: true,
};
const categories = [{ id: 'phones', name: 'Smartphones', slug: 'smartphones' }];
const messages = (content: string) => [{ role: 'user' as const, content }];

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('tryFastCatalogChat', () => {
  it('uses the resolved tenant and returns catalog cards for a shopping question', async () => {
    mocks.categories.mockResolvedValue(categories);
    mocks.products.mockResolvedValue([
      {
        id: 'p1',
        name: 'iPhone 16',
        slug: 'iphone-16',
        brand: 'Apple',
        category: 'Smartphones',
        description: null,
        image_url: null,
        price: 100_000,
        status: 'active',
        stock: 1,
        manage_stock: false,
        has_variants: false,
      },
    ]);
    const result = await tryFastCatalogChat({
      messages: messages('Best gaming phones'),
      tenant,
      signal: new AbortController().signal,
    });
    expect(result?.events[0]?.products[0]?.name).toBe('iPhone 16');
    expect(mocks.categories).toHaveBeenCalledWith('merchant-1');
    expect(mocks.products).toHaveBeenCalledWith(
      'merchant-1',
      expect.objectContaining({ categoryId: 'phones' })
    );
  });

  it('does not read the catalog or intercept payment, order, or negotiation questions', async () => {
    for (const message of [
      'I paid for my phone order',
      'What is your last price for iPhone 16?',
      'Can you reduce the price of iPhone 16 Pro?',
    ]) {
      expect(
        await tryFastCatalogChat({
          messages: messages(message),
          tenant,
          signal: new AbortController().signal,
        })
      ).toBeNull();
    }
    expect(mocks.categories).not.toHaveBeenCalled();
    expect(mocks.products).not.toHaveBeenCalled();
  });

  it('does not change chat behavior for a different merchant', async () => {
    expect(
      await tryFastCatalogChat({
        messages: messages('Show phones'),
        tenant: { ...tenant, merchantSlug: 'other-store' },
        signal: new AbortController().signal,
      })
    ).toBeNull();
    expect(mocks.categories).not.toHaveBeenCalled();
  });

  it('answers a simple greeting without waiting for the model or catalog', async () => {
    const result = await tryFastCatalogChat({
      messages: messages('Hello'),
      tenant,
      signal: new AbortController().signal,
    });
    expect(result?.text).toMatch(/help/i);
    expect(mocks.categories).not.toHaveBeenCalled();
  });

  it('does not replay an earlier user request when the last message is not from the user', async () => {
    expect(
      await tryFastCatalogChat({
        messages: [
          { role: 'user', content: 'Show phones' },
          { role: 'assistant', content: 'Here are phones.' },
        ],
        tenant,
        signal: new AbortController().signal,
      })
    ).toBeNull();
    expect(mocks.categories).not.toHaveBeenCalled();
  });

  it('returns an honest unavailable response if catalog reading exceeds the budget', async () => {
    vi.useFakeTimers();
    mocks.categories.mockReturnValue(new Promise(() => {}));
    const pending = tryFastCatalogChat({
      messages: messages('Show phones'),
      tenant,
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(9000);
    const result = await pending;
    expect(result?.events).toEqual([]);
    expect(result?.text).toMatch(/couldn.t|unavailable/i);
  });
});
