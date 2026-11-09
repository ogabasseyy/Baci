import { describe, expect, it, vi } from 'vitest';
import type { PublicAdvertisedVariantLoader } from './advertised-phone-price-projection';
import { checkRefinedPhoneMatches } from './check-refined-phone-matches';

const products = new Map([
  [
    'phone',
    {
      id: 'phone',
      name: 'iPhone 16',
      category: 'Smartphones',
      has_variants: true,
    },
  ],
]);
const match = {
  productId: 'phone',
  variantId: 'wifi',
  price: 600000,
  condition: 'used',
};
const wifi = {
  id: 'wifi',
  product_id: 'phone',
  attributes: { sim_type: 'Wi-Fi Only', storage: '128GB' },
};
const load = () =>
  vi.fn<PublicAdvertisedVariantLoader>().mockResolvedValue({ phone: [wifi] });

describe('exact refined phone match policy', () => {
  it('preserves explicit restricted identity and reports disclosure facts without substituting an offer', async () => {
    const loader = load();
    const [checked] = await checkRefinedPhoneMatches(
      'merchant',
      'iPhone Wi-Fi Only',
      [match],
      products,
      loader
    );
    expect(checked.match).toBe(match);
    expect(checked.restrictedVariant).toEqual(wifi);
    expect(loader).toHaveBeenCalledExactlyOnceWith('merchant', ['phone']);
  });

  it('preserves an exact unrestricted cellular match', async () => {
    const cellular = {
      ...wifi,
      id: 'cellular',
      attributes: { sim_type: 'Physical + eSIM', storage: '128GB' },
    };
    const cellularMatch = { ...match, variantId: 'cellular' };
    const loader = load().mockResolvedValue({ phone: [cellular] });

    expect(
      await checkRefinedPhoneMatches(
        'merchant',
        'iPhone',
        [cellularMatch],
        products,
        loader
      )
    ).toEqual([{ match: cellularMatch, verifiedVariant: cellular }]);
  });

  it('selects an eligible cellular sibling when an unconstrained match hits a Wi-Fi only variant', async () => {
    const cellular = {
      ...wifi,
      id: 'cellular',
      attributes: { sim_type: 'Physical + eSIM', storage: '128GB' },
      price_override: 900000,
      condition: 'used',
      is_active: true,
      stock_quantity: 5,
    };
    const loader = load().mockResolvedValue({ phone: [wifi, cellular] });

    const checked = await checkRefinedPhoneMatches(
      'merchant',
      'iPhone',
      [match],
      products,
      loader
    );

    expect(checked).toHaveLength(1);
    expect(checked[0]?.match).toMatchObject({
      productId: 'phone',
      variantId: 'cellular',
      price: 900000,
      condition: 'used',
    });
    expect(checked[0]?.verifiedVariant?.id).toBe('cellular');
    expect(checked[0]?.restrictedVariant).toBeUndefined();
  });

  it('drops a Wi-Fi only matched phone when no eligible cellular sibling exists and no Wi-Fi intent is present', async () => {
    const loader = load().mockResolvedValue({ phone: [wifi] });

    const checked = await checkRefinedPhoneMatches(
      'merchant',
      'iPhone',
      [match],
      products,
      loader
    );

    expect(checked).toEqual([]);
  });

  it('drops a stale or missing matched phone SKU without selecting its sibling', async () => {
    const loader = load().mockResolvedValue({
      phone: [{ ...wifi, id: 'another-sku' }],
    });
    expect(
      await checkRefinedPhoneMatches(
        'merchant',
        'iPhone Wi-Fi Only',
        [match],
        products,
        loader
      )
    ).toEqual([]);
    expect(
      await checkRefinedPhoneMatches(
        'merchant',
        'iPhone',
        [{ productId: 'phone' }],
        products,
        loader
      )
    ).toEqual([]);
  });

  it('keeps normal Wi-Fi tablets and avoids extra reads for unrelated result windows', async () => {
    const loader = load();
    const tablets = new Map([
      [
        'phone',
        { id: 'phone', name: 'iPad', category: 'Tablets', has_variants: true },
      ],
    ]);
    expect(
      await checkRefinedPhoneMatches(
        'merchant',
        'tablet',
        [match],
        tablets,
        loader
      )
    ).toEqual([{ match }]);
    expect(loader).not.toHaveBeenCalled();
  });

  it('does not convert a failed public read to an empty successful result', async () => {
    const loader = load().mockRejectedValue(
      new Error('public variant read unavailable')
    );
    await expect(
      checkRefinedPhoneMatches('merchant', 'iPhone', [match], products, loader)
    ).rejects.toThrow('public variant read unavailable');
  });
});
