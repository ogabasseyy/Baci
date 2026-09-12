import { describe, expect, it, vi } from 'vitest';
import { computeRedvaultOrderQuote } from './compute-redvault-order-quote';

const productId = '11111111-1111-4111-8111-111111111111';
const product = {
  id: productId,
  brand: 'Samsung',
  name: 'Galaxy S24',
  price: 100000,
  condition: 'new',
  vat_category_code: 'S',
  vat_rate: 7.5,
};
function client(
  overrides: Record<string, unknown> = {},
  variants: unknown[] = []
) {
  return {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            overrideTypes: async () => ({
              data: [{ ...product, ...overrides }],
              error: null,
            }),
          }),
        }),
      }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: variants, error: null }),
  };
}
const input = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  items: [{ product_id: productId, price: 1, quantity: 1, condition: 'used' }],
};
describe('computeRedvaultOrderQuote', () => {
  it.each([
    [199999.99, 2000000],
    [200000, 1000000],
    [200000.01, 1000000],
  ])('uses authoritative eligible price %s to select the tier', async (price, discount) => {
    const quote = await computeRedvaultOrderQuote({
      ...input,
      supabase: client({ price }) as never,
    });
    expect(quote.discountKobo).toBe(discount);
    expect(quote.groups[0].discountKobo).toBe(discount);
    expect(quote.lines[0].unitDiscountsKobo).toEqual([discount]);
  });

  it('ignores client price and binds canonical catalog fields', async () => {
    const quote = await computeRedvaultOrderQuote({
      ...input,
      supabase: client() as never,
    });
    expect(quote.discountKobo).toBe(1000000);
    expect(quote.lines[0]).toMatchObject({
      condition: 'used',
      unitPriceKobo: 10000000,
      vatRateBp: 750,
    });
  });
  it.each([
    null,
    '',
    ' ',
    -1,
    'NaN',
  ])('rejects invalid catalog price %s', async (price) => {
    await expect(
      computeRedvaultOrderQuote({
        ...input,
        supabase: client({ price }) as never,
      })
    ).rejects.toThrow();
  });
  it.each([
    { variants: [] },
    { variants: [{ id: 'v1', product_id: 'other', price_override: 5 }] },
  ])('rejects missing or cross-product requested variants', async ({
    variants,
  }) => {
    await expect(
      computeRedvaultOrderQuote({
        ...input,
        items: [{ ...input.items[0], variant_id: 'v1' }],
        supabase: client({}, variants) as never,
      })
    ).rejects.toThrow('Variant');
  });
  it('uses a valid variant override when the base price is absent', async () => {
    const quote = await computeRedvaultOrderQuote({
      ...input,
      items: [{ ...input.items[0], variant_id: 'v1' }],
      supabase: client({ price: null }, [
        { id: 'v1', product_id: productId, price_override: 20 },
      ]) as never,
    });
    expect(quote.lines[0].unitPriceKobo).toBe(2000);
  });
  it('mirrors persisted tax column fallbacks for null category and rate', async () => {
    const quote = await computeRedvaultOrderQuote({
      ...input,
      supabase: client({ vat_category_code: null, vat_rate: null }) as never,
    });
    expect(quote.lines[0]).toMatchObject({
      vatCategoryCode: 'S',
      vatRateBp: 750,
    });
  });
  it('preserves a zero-rated category and its stored rate without calculating tax', async () => {
    const quote = await computeRedvaultOrderQuote({
      ...input,
      supabase: client({ vat_category_code: 'Z', vat_rate: 7.5 }) as never,
    });
    expect(quote.lines[0]).toMatchObject({
      vatCategoryCode: 'Z',
      vatRateBp: 750,
    });
  });
});
