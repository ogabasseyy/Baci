import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), row: vi.fn() }));
vi.mock('@/ai/santa-data', () => ({
  getCachedSantaProductList: mocks.catalog,
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.maybeSingle = () => mocks.row();
      return chain;
    },
  }),
}));

import { SANTA_NO_DEAL_REPLY, verifySantaAnswer } from './chat-santa-offers';

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const input = (text: string) => ({
  text,
  merchantId: MERCHANT,
  priceNegotiationEnabled: true,
  currency: 'NGN',
});
const grant = (price: number) =>
  `Ho ho ho, deal! ACTION:ADD_TO_CART|PRODUCT:Demo Phone X|PRICE:${price}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.catalog.mockResolvedValue([
    {
      name: 'Demo Phone X',
      price: 100000,
      max_discount_percentage: 10,
      max_margin_discount_percentage: 10,
      brand: null,
    },
  ]);
  mocks.row.mockResolvedValue({
    data: {
      id: 'p-1',
      name: 'Demo Phone X',
      slug: 'demo-phone-x',
      price: 100000,
      has_variants: false,
    },
    error: null,
  });
});

describe('verifySantaAnswer', () => {
  it('grants a price at the floor, strips the directive and returns the offer', async () => {
    const result = await verifySantaAnswer(input(grant(90000)));
    expect(result).toEqual({
      reply: 'Ho ho ho, deal!',
      offers: [
        {
          productId: 'p-1',
          slug: 'demo-phone-x',
          name: 'Demo Phone X',
          catalogPrice: 100000,
          grantedPrice: 90000,
          currency: 'NGN',
        },
      ],
      dropped: false,
    });
  });

  it('drops a price below the floor and does not promise the deal', async () => {
    const result = await verifySantaAnswer(input(grant(89999)));
    expect(result).toEqual({
      reply: SANTA_NO_DEAL_REPLY,
      offers: [],
      dropped: true,
    });
  });

  it('drops a price above the catalog price', async () => {
    expect((await verifySantaAnswer(input(grant(100001)))).dropped).toBe(true);
  });

  it('drops an unknown product, a variant product and a failed lookup', async () => {
    mocks.catalog.mockResolvedValueOnce([]);
    expect((await verifySantaAnswer(input(grant(95000)))).dropped).toBe(true);

    mocks.row.mockResolvedValueOnce({
      data: {
        id: 'p-1',
        name: 'Demo Phone X',
        slug: '',
        price: 100000,
        has_variants: true,
      },
      error: null,
    });
    expect((await verifySantaAnswer(input(grant(95000)))).dropped).toBe(true);

    mocks.row.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect((await verifySantaAnswer(input(grant(95000)))).dropped).toBe(true);

    mocks.catalog.mockRejectedValueOnce(new Error('down'));
    expect((await verifySantaAnswer(input(grant(95000)))).dropped).toBe(true);
  });

  it('uses the live price, not the cached one, for the ceiling', async () => {
    mocks.row.mockResolvedValueOnce({
      data: {
        id: 'p-1',
        name: 'Demo Phone X',
        slug: 's',
        price: 120000,
        has_variants: false,
      },
      error: null,
    });
    // 90,000 is 25% under the live 120,000: over the 10% ceiling.
    expect((await verifySantaAnswer(input(grant(90000)))).dropped).toBe(true);
  });

  it('passes plain chat through with nothing dropped', async () => {
    expect(
      await verifySantaAnswer(input('Ho ho ho! What do you wish for?'))
    ).toEqual({
      reply: 'Ho ho ho! What do you wish for?',
      offers: [],
      dropped: false,
    });
  });
});
