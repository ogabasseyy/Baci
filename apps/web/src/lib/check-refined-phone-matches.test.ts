import { describe, expect, it, vi } from 'vitest';
import type { PublicAdvertisedVariantLoader } from './advertised-phone-price-projection';
import {
  checkRefinedPhoneMatches,
  hasPositiveWifiOnlyIntent,
} from './check-refined-phone-matches';

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
  it.each([
    'not Wi-Fi Only',
    'without Wi-Fi Only',
    'avoid Wi-Fi Only',
    'exclude Wi-Fi Only',
    "don't show Wi-Fi Only",
  ])('does not infer positive intent from %s', (query) => {
    expect(hasPositiveWifiOnlyIntent(query)).toBe(false);
  });

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
