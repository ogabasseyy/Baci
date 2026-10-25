import { describe, expect, it } from 'vitest';
import {
  type JumiaCanonicalPreflightInput,
  prepareJumiaProductFeed,
} from './prepare-product-feed';

const merchantId = 'a6a6dd33-a9d8-4f71-a668-a95d33578f23';
const categoryId = 'a6a6dd33-a9d8-4f71-a668-a95d33578f26';
const productId = 'a6a6dd33-a9d8-4f71-a668-a95d33578f21';
const imageId = 'a6a6dd33-a9d8-4f71-a668-a95d33578f27';

function input(
  overrides: Partial<JumiaCanonicalPreflightInput> = {}
): JumiaCanonicalPreflightInput {
  return {
    merchantId,
    selectionId: 'a6a6dd33-a9d8-4f71-a668-a95d33578f25',
    sourceCategoryId: categoryId,
    sourceVersion: 'a'.repeat(64),
    source: {
      contractVersion: 1,
      product: {
        id: productId,
        merchantId,
        status: 'active',
        hasVariants: false,
        variantModel: null,
        updatedAt: '2026-10-01T00:00:00Z',
        name: 'Nintendo Switch OLED Console',
        description: 'A handheld gaming console with a bright OLED display.',
        sku: 'SWITCH-OLED',
        exportImages: [],
        price: 300,
        stock: 5,
        stockQuantity: 5,
        manageStock: true,
        inventoryTrackingPolicy: 'off',
        inventoryAnchorVariantId: null,
        condition: 'new',
        weightValue: 0.5,
        weightUnit: 'kg',
        categoryId,
      },
      categoryMemberships: [{ id: categoryId, name: 'Gaming', isActive: true }],
      variants: [],
      images: [
        {
          id: imageId,
          variantId: null,
          status: 'verified',
          verifiedUrl: 'https://images.example.test/switch.jpg',
          verifiedFormat: 'jpg',
          isPrimary: true,
          position: 0,
          verifiedAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ],
    },
    destination: {
      shopId: 'a6a6dd33-a9d8-4f71-a668-a95d33578f28',
      businessClientCode: 'jumia-ng',
      countryCode: 'NG',
      localCurrency: 'NGN',
    },
    mapping: {
      category: {
        code: 123,
        name: 'Gaming / Consoles',
        attributeSetId: 'a6a6dd33-a9d8-4f71-a668-a95d33578f22',
        activeLeaf: true,
        availableForDestination: true,
      },
      brand: { code: 456, name: 'Nintendo', availableForDestination: true },
      attributes: [
        {
          code: 1,
          name: 'short_description',
          description: 'Highlights',
          type: 0,
          mandatory: false,
          variation: false,
          translatable: false,
        },
      ],
      values: {},
      categoryConfirmed: true,
      bullets: [
        'Play games at home and on the go',
        'Vibrant OLED display',
        'Comfortable handheld controls',
        'Connects to a television',
      ],
    },
    evidence: {
      providerClassification: 'non-3c',
      globalPrice: { currency: 'USD', value: 300 },
      images: {
        [imageId]: {
          publiclyReachable: true,
          byteSize: 1000,
          width: 1000,
          height: 1000,
          qualityAccepted: true,
        },
      },
    },
    ...overrides,
  };
}

describe('prepareJumiaProductFeed', () => {
  it('prepares a canonical non-variant record without mutating its inputs', () => {
    const request = input();
    const before = structuredClone(request);
    expect(prepareJumiaProductFeed(request)).toMatchObject({
      success: true,
      products: [
        {
          name: { value: 'Nintendo Switch OLED Console' },
          parentSku: 'SWITCH-OLED',
          sellerSku: 'SWITCH-OLED',
          variation: '...',
          price: { currency: 'USD', value: 300 },
          businessClients: [
            {
              businessClientCode: 'jumia-ng',
              price: { currency: 'NGN', value: 300 },
            },
          ],
          stock: 5,
          attributes: [
            {
              name: 'short_description',
              value: expect.stringContaining('<li>'),
            },
          ],
        },
      ],
    });
    expect(request).toEqual(before);
  });

  it('blocks absent trusted global price, unproven image quality, and unknown classification all-or-nothing', () => {
    const result = prepareJumiaProductFeed(
      input({
        evidence: {
          providerClassification: 'unknown',
          globalPrice: null,
          images: {
            [imageId]: {
              publiclyReachable: true,
              byteSize: null,
              width: null,
              height: null,
              qualityAccepted: false,
            },
          },
        },
      })
    );
    expect(result).toMatchObject({
      success: false,
      products: [],
      errors: expect.arrayContaining([
        expect.objectContaining({ code: 'global_price_unproven' }),
        expect.objectContaining({ code: 'classification_unproven' }),
        expect.objectContaining({ code: 'image_evidence_incomplete' }),
      ]),
    });
  });

  it('uses the anchor-only product fallback and excludes the anchor variant from sellable records', () => {
    const base = input();
    const result = prepareJumiaProductFeed(
      input({
        source: {
          ...base.source,
          product: {
            ...base.source.product,
            hasVariants: true,
            inventoryAnchorVariantId: 'a6a6dd33-a9d8-4f71-a668-a95d33578f29',
          },
          variants: [
            {
              id: 'a6a6dd33-a9d8-4f71-a668-a95d33578f29',
              attributes: {},
              sku: 'ANCHOR',
              priceOverride: 25,
              stockQuantity: 0,
              inventoryTrackingPolicy: 'inherit',
              condition: 'new',
              updatedAt: '2026-10-01T00:00:00Z',
              isInventoryAnchor: true,
            },
          ],
        },
      })
    );
    expect(result).toMatchObject({
      success: true,
      products: [{ sellerSku: 'SWITCH-OLED', stock: 5 }],
    });
  });

  it('prepares sellable variants in stable identity order, excludes the anchor, and uses canonical prices and stock', () => {
    const base = input();
    const variants = [
      {
        id: '00000000-0000-4000-8000-000000000003',
        attributes: { storage: '256 GB' },
        sku: 'S-256',
        priceOverride: null,
        stockQuantity: 7,
        inventoryTrackingPolicy: 'inherit',
        condition: 'new',
        updatedAt: '2026-10-01T00:00:00Z',
        isInventoryAnchor: false,
      },
      {
        id: '00000000-0000-4000-8000-000000000001',
        attributes: {},
        sku: 'ANCHOR',
        priceOverride: null,
        stockQuantity: 0,
        inventoryTrackingPolicy: 'inherit',
        condition: 'new',
        updatedAt: '2026-10-01T00:00:00Z',
        isInventoryAnchor: true,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        attributes: { storage: '128 GB' },
        sku: 'S-128',
        priceOverride: 320,
        stockQuantity: 4,
        inventoryTrackingPolicy: 'inherit',
        condition: 'new',
        updatedAt: '2026-10-01T00:00:00Z',
        isInventoryAnchor: false,
      },
    ];
    const mapping = {
      ...base.mapping,
      attributes: [
        {
          code: 2,
          name: 'storage',
          description: 'Storage',
          type: 0 as const,
          mandatory: true,
          variation: true,
          translatable: false,
        },
      ],
      values: {},
      variation: { sourceAttributeName: 'storage' },
    };
    const result = prepareJumiaProductFeed(
      input({
        mapping,
        source: {
          ...base.source,
          product: {
            ...base.source.product,
            hasVariants: true,
            inventoryAnchorVariantId: variants[1].id,
          },
          variants,
        },
      })
    );
    expect(result).toMatchObject({
      success: true,
      products: [
        {
          parentSku: 'S-128',
          sellerSku: 'S-128',
          variation: '128 GB',
          stock: 4,
          businessClients: [{ price: { currency: 'NGN', value: 320 } }],
        },
        {
          parentSku: 'S-128',
          sellerSku: 'S-256',
          variation: '256 GB',
          stock: 7,
          businessClients: [{ price: { currency: 'NGN', value: 300 } }],
        },
      ],
    });
    expect(
      result.success && result.products.map((record) => record.sellerSku)
    ).not.toContain('ANCHOR');
  });

  it('fails the whole family when a special canonical attribute conflicts with merchant intent', () => {
    const base = input();
    const result = prepareJumiaProductFeed(
      input({
        mapping: {
          ...base.mapping,
          values: { '1': 'merchant supplied short description' },
        },
      })
    );
    expect(result).toMatchObject({
      success: false,
      products: [],
      errors: [expect.objectContaining({ code: 'special_attribute_conflict' })],
    });
  });

  it('serializes a single selected provider option to its exact active option name', () => {
    const base = input();
    const result = prepareJumiaProductFeed(
      input({
        mapping: {
          ...base.mapping,
          attributes: [
            {
              code: 9,
              name: 'edition',
              description: 'Edition',
              type: 4,
              mandatory: true,
              variation: false,
              translatable: false,
              options: [
                {
                  id: 12,
                  sid: 'a6a6dd33-a9d8-4f71-a668-a95d33578f31',
                  name: 'OLED',
                  position: 1,
                  isDefault: false,
                  status: 'ACTIVE',
                },
              ],
            },
          ],
          values: { '9': 12 },
        },
      })
    );
    expect(result).toMatchObject({
      success: true,
      products: [{ attributes: [{ name: 'edition', value: 'OLED' }] }],
    });
  });

  it('blocks undocumented multi-selection serialization and returns no partial records', () => {
    const base = input();
    const result = prepareJumiaProductFeed(
      input({
        mapping: {
          ...base.mapping,
          attributes: [
            {
              code: 10,
              name: 'features',
              description: 'Features',
              type: 3,
              mandatory: true,
              variation: false,
              translatable: false,
              options: [
                {
                  id: 21,
                  sid: 'a6a6dd33-a9d8-4f71-a668-a95d33578f32',
                  name: 'Portable',
                  position: 1,
                  isDefault: false,
                  status: 'ACTIVE',
                },
                {
                  id: 22,
                  sid: 'a6a6dd33-a9d8-4f71-a668-a95d33578f33',
                  name: 'Dockable',
                  position: 2,
                  isDefault: false,
                  status: 'ACTIVE',
                },
              ],
            },
          ],
          values: { '10': [21, 22] },
        },
      })
    );
    expect(result).toMatchObject({
      success: false,
      products: [],
      errors: [
        expect.objectContaining({
          code: 'multi_select_serialization_unsupported',
        }),
      ],
    });
  });

  it('blocks unmanaged stock and sibling-specific image sets instead of inferring defaults', () => {
    const base = input();
    const variantId = '00000000-0000-4000-8000-000000000002';
    const newImageId = 'a6a6dd33-a9d8-4f71-a668-a95d33578f34';
    const result = prepareJumiaProductFeed(
      input({
        source: {
          ...base.source,
          product: {
            ...base.source.product,
            hasVariants: true,
            inventoryTrackingPolicy: 'serialized_strict',
          },
          variants: [
            {
              id: variantId,
              attributes: { storage: '128 GB' },
              sku: 'S-128',
              priceOverride: null,
              stockQuantity: 2,
              inventoryTrackingPolicy: 'serialized_strict',
              condition: 'new',
              updatedAt: '2026-10-01T00:00:00Z',
              isInventoryAnchor: false,
            },
            {
              id: '00000000-0000-4000-8000-000000000003',
              attributes: { storage: '256 GB' },
              sku: 'S-256',
              priceOverride: null,
              stockQuantity: 3,
              inventoryTrackingPolicy: 'serialized_strict',
              condition: 'new',
              updatedAt: '2026-10-01T00:00:00Z',
              isInventoryAnchor: false,
            },
          ],
          images: [
            ...base.source.images,
            {
              id: newImageId,
              variantId,
              status: 'verified',
              verifiedUrl: 'https://images.example.test/switch-2.jpg',
              verifiedFormat: 'jpg',
              isPrimary: false,
              position: 1,
              verifiedAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-10-01T00:00:00Z',
            },
          ],
        },
        evidence: {
          ...base.evidence,
          images: {
            ...base.evidence.images,
            [newImageId]: {
              publiclyReachable: true,
              byteSize: 1000,
              width: 1000,
              height: 1000,
              qualityAccepted: true,
            },
          },
        },
      })
    );
    expect(result).toMatchObject({
      success: false,
      products: [],
      errors: expect.arrayContaining([
        expect.objectContaining({ code: 'image_sibling_set_mismatch' }),
      ]),
    });
    const unmanaged = prepareJumiaProductFeed(
      input({
        source: {
          ...base.source,
          product: { ...base.source.product, manageStock: false },
        },
      })
    );
    expect(unmanaged).toMatchObject({
      success: false,
      products: [],
      errors: [expect.objectContaining({ code: 'managed_stock_unproven' })],
    });
  });

  it('rejects non-distinct variation values and duplicate variant SKUs before returning records', () => {
    const base = input();
    const variants = [
      {
        id: '00000000-0000-4000-8000-000000000002',
        attributes: { storage: '128 GB' },
        sku: 'DUP',
        priceOverride: null,
        stockQuantity: 7,
        inventoryTrackingPolicy: 'inherit',
        condition: 'new',
        updatedAt: '2026-10-01T00:00:00Z',
        isInventoryAnchor: false,
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        attributes: { storage: '128 GB' },
        sku: 'DUP',
        priceOverride: null,
        stockQuantity: 4,
        inventoryTrackingPolicy: 'inherit',
        condition: 'new',
        updatedAt: '2026-10-01T00:00:00Z',
        isInventoryAnchor: false,
      },
    ];
    const mapping = {
      ...base.mapping,
      attributes: [
        {
          code: 2,
          name: 'storage',
          description: 'Storage',
          type: 0 as const,
          mandatory: true,
          variation: true,
          translatable: false,
        },
      ],
      values: {},
      variation: { sourceAttributeName: 'storage' },
    };
    const result = prepareJumiaProductFeed(
      input({
        mapping,
        source: {
          ...base.source,
          product: { ...base.source.product, hasVariants: true },
          variants,
        },
      })
    );
    expect(result).toMatchObject({
      success: false,
      products: [],
      errors: expect.arrayContaining([
        expect.objectContaining({ code: 'variation_value_not_distinct' }),
        expect.objectContaining({ code: 'duplicate_seller_sku' }),
      ]),
    });
  });
});
