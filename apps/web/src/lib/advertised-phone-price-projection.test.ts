import { describe, expect, it, vi } from 'vitest';
import { normalizeCategoryPageProducts } from '@/app/(storefront)/[slug]/(catalog)/(listing)/[category]/category-page-content-helpers';
import { mapHomeProductsToTemplateProducts } from '@/app/(storefront)/ogabassey/ogabassey-home-product-adapter';
import { mapStorefrontProductsToOgabasseyProducts } from '@/components/storefront/ogabassey/home-product-feed';
import { requiresOgabasseyProductSelection } from '@/components/storefront/ogabassey/product-selection';
import {
  type AdvertisedPhoneConstraints,
  type AdvertisedPhoneProduct,
  type PublicAdvertisedVariantLoader,
  projectAdvertisedPhonePrices,
} from './advertised-phone-price-projection';
import { normalizeProduct } from './normalize-product';
import { isRawDbProductRecord, type RawDbProduct } from './raw-db-product';

function requireRawProduct(value: unknown): RawDbProduct {
  if (!isRawDbProductRecord(value))
    throw new TypeError('Expected a finite priced product fixture');
  return value;
}

const phone = {
  id: 'iphone16',
  name: 'iPhone 16',
  price: 600000,
  category: 'Smartphones',
  slug: 'iphone-16',
  condition: 'used',
  has_variants: true,
  variant_model: 'sku_matrix' as const,
  manage_stock: false,
  stock: 0,
};

const makeVariant = (
  id: string,
  price: number,
  condition: string,
  sim = 'Physical + eSIM',
  storage = '128GB'
) => ({
  id,
  product_id: phone.id,
  attributes: { sim_type: sim, storage },
  price_override: price,
  condition,
  stock_quantity: 0,
});

const variants = [
  makeVariant('restricted', 600000, 'used', 'Wi-Fi Only'),
  makeVariant('cellular', 900000, 'new'),
  makeVariant('cellular256', 1100000, 'new', 'Physical + eSIM', '256GB'),
];
const load = () => vi.fn().mockResolvedValue({ [phone.id]: variants });

const project = <T extends AdvertisedPhoneProduct>(
  items: T[],
  loader: PublicAdvertisedVariantLoader = load(),
  constraints?: AdvertisedPhoneConstraints
) => projectAdvertisedPhonePrices('merchant', items, loader, constraints);

describe('bounded advertised phone-price projection', () => {
  it('validates direct listing projection inputs before loading any public variants', async () => {
    const loader = load();
    await expect(
      project([{ ...phone, price: 'bad-price' }], loader)
    ).rejects.toThrow('Invalid public listing product projection');
    expect(loader).not.toHaveBeenCalled();
  });

  it('does not advertise a changed default offer outside the user budget or condition filter', async () => {
    expect(await project([phone], load(), { maxPrice: 700000 })).toEqual([]);
    expect(await project([phone], load(), { condition: 'used' })).toEqual([]);
  });

  it('does not borrow a parent discount and uses the selected primary image without changing raw parent facts', async () => {
    const img = 'https://cdn.example.com/cellular.jpg';
    const parent = {
      ...phone,
      compare_at_price: 1200000,
      images: ['https://cdn.example.com/family.jpg'],
    };
    const loader = load().mockResolvedValue({
      iphone16: variants.map((v) =>
        v.id === 'cellular' ? { ...v, primary_image: img } : v
      ),
    });
    const [projected] = await project([parent], loader);
    expect(projected).toMatchObject({
      price: 600000,
      compare_at_price: 1200000,
      images: parent.images,
      advertised_price: 900000,
      advertised_compare_at_price: null,
      advertised_image: img,
    });
    const normalized = normalizeProduct(requireRawProduct(projected));
    expect(normalized.compare_at_price).toBeNull();
    expect(normalized.image).toBe(img);
    expect(normalized.images).toEqual([img]);
    const template = mapHomeProductsToTemplateProducts([projected])[0];
    expect(template.compare_at_price).toBeUndefined();
    expect(template.image).toBe(img);
    expect(mapStorefrontProductsToOgabasseyProducts([template])[0].image).toBe(
      img
    );
  });

  it('projects the eligible cellular price while preserving the real parent checkout base and no client variant arrays', async () => {
    const loader = load();
    const [projected] = await project([phone], loader);
    expect(projected).toMatchObject({
      price: 600000,
      advertised_price: 900000,
      advertised_condition: 'new',
      advertised_min_variant_price: 900000,
      advertised_max_variant_price: 1100000,
      has_variants: true,
    });
    expect(projected).not.toHaveProperty('variants');
    expect(projected).not.toHaveProperty('product_variants');
    expect(loader).toHaveBeenCalledExactlyOnceWith('merchant', ['iphone16']);
    expect(phone.price).toBe(600000);
  });

  it('uses projected prices and selection guards in actual home and category card mapper chains', async () => {
    const rows = await project([phone]);
    const home = mapStorefrontProductsToOgabasseyProducts(
      mapHomeProductsToTemplateProducts(rows)
    );
    const category = normalizeCategoryPageProducts(
      rows.map(requireRawProduct),
      'smartphones'
    );
    for (const card of [home[0], category[0]]) {
      expect(card.rawPrice).toBe(900000);
      expect(card.price).not.toContain('600');
      expect(card.condition).toBe('New');
      expect(requiresOgabasseyProductSelection(card)).toBe(true);
      expect(card).not.toHaveProperty('variants');
    }
  });

  it('does not inherit a projected price when a variant override is null', async () => {
    const loader = vi.fn<PublicAdvertisedVariantLoader>().mockResolvedValue({
      iphone16: [{ ...variants[1], price_override: null }],
    });
    const [projected] = await project([{ ...phone, price: 1000000 }], loader);
    expect(projected).toMatchObject({
      price: 1000000,
      advertised_price: 1000000,
    });
  });

  it('excludes only-restricted phone families from standard cards and leaves Wi-Fi tablets untouched', async () => {
    const tablet = {
      ...phone,
      id: 'ipad',
      name: 'iPad',
      category: 'Tablets',
      price: 700000,
    };
    const loader = vi
      .fn<PublicAdvertisedVariantLoader>()
      .mockResolvedValue({ iphone16: [variants[0]] });
    const rows = await project([phone, tablet], loader);
    expect(rows).toEqual([tablet]);
    expect(loader).toHaveBeenCalledExactlyOnceWith('merchant', ['iphone16']);
  });

  it('does not advertise unavailable serialized variants on an otherwise unmanaged parent', async () => {
    const loader = vi.fn<PublicAdvertisedVariantLoader>().mockResolvedValue({
      iphone16: [
        {
          ...variants[1],
          effective_policy: 'serialized_strict',
          available_units: 0,
        },
      ],
    });
    expect(await project([phone], loader)).toEqual([]);
  });

  it('does not read variants for simple phones or unrelated products', async () => {
    const loader = load();
    const simple = { ...phone, has_variants: false, variant_model: 'legacy' };
    expect(await project([simple], loader)).toEqual([simple]);
    expect(loader).not.toHaveBeenCalled();
  });

  it('does not filter out accessory products with variants when variants are unpurchasable', async () => {
    const loader = load();
    const phoneCase = {
      ...phone,
      id: 'case-1',
      name: 'iPhone 15 Pro Silicone Case',
      category: 'Phone Accessories',
      price: 25000,
      manage_stock: true,
    };
    expect(await project([phoneCase], loader)).toEqual([phoneCase]);
    expect(loader).not.toHaveBeenCalled();
  });

  it('propagates an unreadable public projection rather than returning the restricted parent minimum', async () => {
    const loader = load().mockRejectedValue(
      new Error('Public variants unavailable')
    );
    await expect(project([phone], loader)).rejects.toThrow(
      'Public variants unavailable'
    );
  });

  it('advertises the cellular variant for phones categorized through product_categories with null legacy category', async () => {
    const categorizedPhone = {
      ...phone,
      id: 'moto-50',
      category: null,
      product_categories: [
        { categories: { name: 'Smartphones', slug: 'smartphones' } },
      ],
    };
    const loader = load().mockResolvedValue({
      'moto-50': variants.map((v) => ({ ...v, product_id: 'moto-50' })),
    });
    const [projected] = await project([categorizedPhone], loader);
    expect(projected).toMatchObject({
      advertised_price: 900000,
      advertised_condition: 'new',
    });
  });

  it('applies canonical condition fallback when filtering phone families with null condition', async () => {
    const unconditionedPhone = {
      ...phone,
      id: 'pixel-9',
      condition: null,
      available_conditions: ['new'],
    };
    const loader = load().mockResolvedValue({
      'pixel-9': [{ ...variants[1], product_id: 'pixel-9', condition: null }],
    });
    const projected = await project([unconditionedPhone], loader, {
      condition: 'new',
    });
    expect(projected).toMatchObject([
      { id: 'pixel-9', advertised_condition: 'new', advertised_price: 900000 },
    ]);
    expect(
      await project([unconditionedPhone], loader, { condition: 'used' })
    ).toEqual([]);
  });
});
