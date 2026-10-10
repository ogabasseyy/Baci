import { describe, expect, it } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import { createCriticalCartProduct } from './critical-cart-product';

type CriticalCartInput = Parameters<typeof createCriticalCartProduct>[0];

function buildCriticalCartInput(
  overrides: Partial<CriticalCartInput> = {}
): CriticalCartInput {
  return {
    brand: 'OgaBassey',
    description: 'Legacy Gadget',
    gtin: '',
    id: 'product-base',
    image: 'https://cdn.ogabassey.com/base.avif',
    imageHint: 'Legacy Gadget',
    imageLarge: 'https://cdn.ogabassey.com/base.avif',
    manage_stock: true,
    mpn: 'BASE',
    name: 'Legacy Gadget',
    price: 100_000,
    slug: 'legacy-gadget',
    status: 'active',
    stock: 1,
    ...overrides,
  };
}

describe('createCriticalCartProduct', () => {
  it('creates a cart-compatible product from the server PDP product', () => {
    const sourceProduct = {
      brand: 'Dell',
      category: 'Laptops',
      category_slug: 'laptops',
      condition: 'used',
      description: '<p>Gaming laptop</p>',
      gtin: '',
      id: 'product-1',
      image: 'https://cdn.ogabassey.com/alienware.avif',
      imageHint: 'Dell Alienware laptop',
      imageLarge: 'https://cdn.ogabassey.com/alienware-large.avif',
      manage_stock: true,
      mpn: 'AW-M18-R3',
      name: 'Dell Alienware m18 R3 (RTX 5080)',
      price: 7_098_000,
      slug: 'dell-alienware-m18-r3-rtx-5080',
      status: 'active',
      stock: 4,
    } satisfies CartProduct;

    expect(createCriticalCartProduct(sourceProduct)).toMatchObject({
      brand: 'Dell',
      category: 'Laptops',
      category_slug: 'laptops',
      condition: 'used',
      description: '<p>Gaming laptop</p>',
      id: 'product-1',
      image: 'https://cdn.ogabassey.com/alienware.avif',
      imageLarge: 'https://cdn.ogabassey.com/alienware-large.avif',
      manage_stock: true,
      price: 7_098_000,
      slug: 'dell-alienware-m18-r3-rtx-5080',
      status: 'active',
      stock: 4,
    });
  });

  it('preserves variant data so addToCart can resolve a default variant', () => {
    const cartProduct = createCriticalCartProduct({
      brand: 'Lenovo',
      description: 'Lenovo Legion Pro 9',
      gtin: '',
      has_variants: true,
      id: 'product-2',
      image: 'https://cdn.ogabassey.com/legion.avif',
      imageHint: 'Lenovo Legion laptop',
      imageLarge: 'https://cdn.ogabassey.com/legion.avif',
      manage_stock: true,
      mpn: 'LEGION-PRO-9',
      name: 'Lenovo Legion Pro 9',
      price: 5_985_000,
      slug: 'lenovo-legion-pro-9',
      status: 'active',
      stock: 2,
      variants: [
        {
          attributes: { platform: 'EU', storage: '2TB' },
          condition: 'new',
          id: 'variant-1',
          merchant_id: 'merchant-1',
          product_id: 'product-2',
          stock_quantity: 2,
        },
      ],
    });

    expect(cartProduct.has_variants).toBe(true);
    expect(cartProduct.variants?.[0]).toMatchObject({
      attributes: { platform: 'EU', storage: '2TB' },
      id: 'variant-1',
    });
  });

  it('treats missing stock flags as managed by default', () => {
    const legacyInput = {
      ...buildCriticalCartInput({
        brand: '',
        description: '',
        image: 'https://cdn.ogabassey.com/legacy.avif',
        imageHint: '',
        imageLarge: '',
        manage_stock: undefined as unknown as boolean,
        mpn: '',
        stock: -2,
      }),
      condition: 'damaged',
    } as unknown as CriticalCartInput;
    const cartProduct = createCriticalCartProduct(legacyInput);

    expect(cartProduct).toMatchObject({
      brand: 'OgaBassey',
      condition: undefined,
      description: 'Legacy Gadget',
      imageHint: 'Legacy Gadget',
      imageLarge: 'https://cdn.ogabassey.com/legacy.avif',
      manage_stock: true,
      mpn: 'legacy-gadget',
      stock: 0,
    });
  });

  it('falls back to the product id when slug and mpn are missing', () => {
    const cartProduct = createCriticalCartProduct({
      ...buildCriticalCartInput(),
      id: 'product-4',
      image: 'https://cdn.ogabassey.com/no-slug.avif',
      mpn: '',
      name: 'No Slug Gadget',
      price: 90_000,
      slug: undefined,
    });

    expect(cartProduct.mpn).toBe('product-4');
  });
});
