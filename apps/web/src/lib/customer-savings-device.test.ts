import { describe, expect, it } from 'vitest';
import {
  resolveSavingsDeviceSelection,
  type SavingsDeviceProduct,
  SavingsDeviceProductSchema,
} from './customer-savings-device';

const PRODUCT_ID = '00000000-0000-4000-8000-000000000101';
const VARIANT_256 = '00000000-0000-4000-8000-000000000102';
const VARIANT_128 = '00000000-0000-4000-8000-000000000103';

const multiVariantProduct: SavingsDeviceProduct = {
  condition: 'used',
  id: PRODUCT_ID,
  images: ['https://cdn.example.com/iphone.jpg'],
  name: 'iPhone 15 Pro',
  price: '700000',
  variants: [
    {
      attributes: { color: 'Black', storage: '256GB' },
      condition: 'used',
      id: VARIANT_256,
      images: ['https://cdn.example.com/iphone-256.jpg'],
      price_override: '850000',
      primary_image: 'https://cdn.example.com/iphone-256.jpg',
      sku: 'IP15-256',
    },
    {
      attributes: { storage: '128GB' },
      condition: 'new',
      id: VARIANT_128,
      price_override: '700000',
    },
  ],
};

describe('resolveSavingsDeviceSelection', () => {
  const anchorProduct = () =>
    SavingsDeviceProductSchema.parse({
      id: PRODUCT_ID,
      name: 'Serialized device',
      price: 700000,
      variants: [{ id: VARIANT_128, is_inventory_anchor: true }],
    });

  it('allows a simple serialized product with only an inventory anchor to omit variant', () => {
    expect(
      resolveSavingsDeviceSelection({ product: anchorProduct() })
    ).toMatchObject({
      ok: true,
      variantId: null,
      cataloguePrice: 700000,
    });
  });

  it('rejects an internal inventory anchor as a customer-selected variant', () => {
    expect(
      resolveSavingsDeviceSelection({
        product: anchorProduct(),
        variantId: VARIANT_128,
      })
    ).toMatchObject({ ok: false, status: 404 });
  });

  it('requires an explicit variant when the product has variants', () => {
    const result = resolveSavingsDeviceSelection({
      clientTargetAmount: 700000,
      product: multiVariantProduct,
      variantId: null,
    });

    expect(result).toEqual({
      code: 'SAVINGS_DEVICE_VARIANT_REQUIRED',
      error: 'Select the exact device variant to save for',
      ok: false,
      status: 400,
    });
  });

  it('rejects a variant that does not belong to the selected product', () => {
    const result = resolveSavingsDeviceSelection({
      clientTargetAmount: 850000,
      product: multiVariantProduct,
      variantId: '00000000-0000-4000-8000-000000000999',
    });

    expect(result).toMatchObject({
      code: 'SAVINGS_DEVICE_VARIANT_NOT_FOUND',
      ok: false,
      status: 404,
    });
  });

  it('uses the selected variant identity and authoritative price', () => {
    const result = resolveSavingsDeviceSelection({
      clientTargetAmount: 850000,
      product: multiVariantProduct,
      variantId: VARIANT_256,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.cataloguePrice).toBe(850000);
    expect(result.targetAmount).toBe(850000);
    expect(result.variantId).toBe(VARIANT_256);
    expect(result.snapshot).toEqual({
      condition: 'used',
      image: 'https://cdn.example.com/iphone-256.jpg',
      name: 'iPhone 15 Pro',
      price: 850000,
      selectionStatus: 'exact',
      variantId: VARIANT_256,
      variantLabel: 'Color: Black · Storage: 256GB',
    });
  });

  it('rejects a client target below the authoritative variant price', () => {
    expect(
      resolveSavingsDeviceSelection({
        clientTargetAmount: 700000,
        product: multiVariantProduct,
        variantId: VARIANT_256,
      })
    ).toEqual({
      code: 'SAVINGS_DEVICE_PRICE_STALE',
      error: 'Savings target is below the current device price',
      ok: false,
      status: 409,
    });
  });

  it('keeps a higher customer target without repricing down to catalogue', () => {
    const result = resolveSavingsDeviceSelection({
      clientTargetAmount: 900000,
      product: multiVariantProduct,
      variantId: VARIANT_256,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.cataloguePrice).toBe(850000);
    expect(result.targetAmount).toBe(900000);
    expect(result.snapshot.price).toBe(900000);
  });

  it('allows a product with no variants to omit variant id', () => {
    const result = resolveSavingsDeviceSelection({
      clientTargetAmount: 500000,
      product: {
        condition: 'new',
        id: PRODUCT_ID,
        images: ['https://cdn.example.com/simple.jpg'],
        name: 'Charger',
        price: '500000',
        variants: [],
      },
      variantId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.variantId).toBeNull();
    expect(result.cataloguePrice).toBe(500000);
    expect(result.snapshot.selectionStatus).toBe('exact');
    expect(result.snapshot.variantLabel).toBeNull();
  });

  it('does not silently choose another variant when attributes change', () => {
    const first = resolveSavingsDeviceSelection({
      product: multiVariantProduct,
      variantId: VARIANT_256,
    });
    const second = resolveSavingsDeviceSelection({
      product: multiVariantProduct,
      variantId: VARIANT_128,
    });

    expect(first.ok && first.variantId).toBe(VARIANT_256);
    expect(second.ok && second.variantId).toBe(VARIANT_128);
    expect(first.ok && first.cataloguePrice).toBe(850000);
    expect(second.ok && second.cataloguePrice).toBe(700000);
  });
});
