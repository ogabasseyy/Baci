import { describe, expect, it } from 'vitest';
import {
  buildProductSemanticModel,
  MAX_SEMANTIC_SECTION_CARDS,
} from './build-product-semantic-model';
import {
  makeCandidate,
  makeInput,
} from './build-product-semantic-model.test-helpers';

describe('buildProductSemanticModel', () => {
  it('ranks alternatives by condition bucket, stock, price distance, spec overlap, then slug', () => {
    const currentProduct = makeCandidate({
      slug: 'samsung-galaxy-s25',
      name: 'Samsung Galaxy S25',
      brand: 'Samsung',
      price: 900_000,
      product_key_specs: {
        chipset: 'Snapdragon 8 Elite',
        ram_gb: 12,
        storage_gb: 256,
        screen_size_inches: 6.7,
      },
    });
    const model = buildProductSemanticModel(
      makeInput({
        currentProduct,
        inventory: [
          currentProduct,
          makeCandidate({
            slug: 'pixel-10',
            name: 'Pixel 10',
            brand: 'Google',
            price: 905_000,
            stock: 9,
            product_key_specs: {
              chipset: 'Tensor X',
              ram_gb: 12,
              storage_gb: 256,
              screen_size_inches: 6.7,
            },
          }),
          makeCandidate({
            slug: 'iphone-17-air',
            name: 'iPhone 17 Air',
            brand: 'Apple',
            price: 898_000,
            stock: 0,
            product_key_specs: {
              chipset: 'A19',
              ram_gb: 8,
              storage_gb: 128,
              screen_size_inches: 6.1,
            },
          }),
          makeCandidate({
            slug: 'used-xperia-1-vii',
            name: 'Used Xperia 1 VII',
            brand: 'Sony',
            condition: 'used',
            price: 901_000,
            stock: 9,
            product_key_specs: {
              chipset: 'Snapdragon 8 Elite',
              ram_gb: 12,
              storage_gb: 512,
              screen_size_inches: 6.7,
            },
          }),
        ],
      })
    );

    expect(model.alternatives?.cards.map((card) => card.title)).toEqual([
      'Pixel 10',
      'iPhone 17 Air',
      'Used Xperia 1 VII',
    ]);
  });

  it('returns null card sections when inventory is missing and when the current product has no brand', () => {
    const missingInventoryModel = buildProductSemanticModel(
      makeInput({
        currentProduct: makeCandidate({
          slug: 'mystery-phone',
          name: 'Mystery Phone',
          price: 250_000,
        }),
        inventory: [],
      })
    );

    expect(missingInventoryModel.supportLinks).toEqual([
      {
        href: 'https://ogabassey.com/smartphones',
        label: 'Shop more Smartphones',
      },
    ]);
    expect(missingInventoryModel.guideLinks).toEqual([]);
    expect(missingInventoryModel.alternatives).toBeNull();
    expect(missingInventoryModel.sameBrand).toBeNull();
    expect(missingInventoryModel.samePrice).toBeNull();

    const noBrandModel = buildProductSemanticModel(
      makeInput({
        currentProduct: makeCandidate({
          slug: 'house-brand-phone',
          name: 'House Brand Phone',
          price: 310_000,
          product_key_specs: { chipset: 'Custom', ram_gb: 6, storage_gb: 128 },
        }),
        inventory: [
          makeCandidate({
            slug: 'house-brand-phone',
            name: 'House Brand Phone',
            price: 310_000,
            product_key_specs: {
              chipset: 'Custom',
              ram_gb: 6,
              storage_gb: 128,
            },
          }),
          makeCandidate({
            slug: 'tecno-spark-40',
            name: 'Tecno Spark 40',
            brand: 'Tecno',
            price: 300_000,
            stock: 8,
            product_key_specs: {
              chipset: 'MediaTek',
              ram_gb: 8,
              storage_gb: 128,
            },
          }),
        ],
      })
    );

    expect(noBrandModel.sameBrand).toBeNull();
    expect(noBrandModel.guideLinks).toEqual([]);
  });

  it('keeps the viewed product independent of a saturated enrichment inventory cap', () => {
    // The PDP enrichment RPC caps its OTHER-product inventory
    // (PDP_SEMANTIC_INVENTORY_LIMIT = 48). The viewed product is sourced from
    // the bounded PDP core snapshot, never from that capped inventory, so a full
    // inventory that does NOT contain the current product must never drop it:
    // its own support surface stays, and it is excluded from its own
    // alternative/same-brand/same-price cards (it is the anchor, not a
    // candidate). The cap therefore only bounds the OTHER candidates and can
    // never crowd the viewed product out of its own PDP.
    const SATURATED_ENRICHMENT_INVENTORY = 48;
    const currentProduct = makeCandidate({
      slug: 'anchor-flagship',
      name: 'Anchor Flagship',
      brand: 'Apple',
      price: 500_000,
      product_key_specs: { chipset: 'A19 Pro', ram_gb: 8, storage_gb: 256 },
    });
    const inventory = Array.from(
      { length: SATURATED_ENRICHMENT_INVENTORY },
      (_, index) =>
        makeCandidate({
          slug: `enrichment-candidate-${index}`,
          name: `Enrichment Candidate ${index}`,
          brand: index % 2 === 0 ? 'Apple' : 'Samsung',
          price: 480_000 + index * 1_000,
          product_key_specs: {
            chipset: `Chip ${index}`,
            ram_gb: 8,
            storage_gb: 128,
          },
        })
    );

    const model = buildProductSemanticModel(
      makeInput({ currentProduct, inventory })
    );

    // The viewed product's own presentation survives regardless of inventory
    // size — the category hub link is derived from the current product.
    expect(model.supportLinks).toEqual(
      expect.arrayContaining([
        {
          href: 'https://ogabassey.com/smartphones',
          label: 'Shop more Smartphones',
        },
      ])
    );

    // The viewed product is the anchor: it never appears as a candidate card,
    // and the capped inventory only bounds the OTHER candidates (<= MAX cards).
    const allCards = [
      ...(model.alternatives?.cards ?? []),
      ...(model.sameBrand?.cards ?? []),
      ...(model.samePrice?.cards ?? []),
    ];
    expect(
      allCards.some((card) => card.href.endsWith('/anchor-flagship'))
    ).toBe(false);
    expect(model.alternatives?.cards.length ?? 0).toBeLessThanOrEqual(
      MAX_SEMANTIC_SECTION_CARDS
    );
    expect(model.sameBrand?.cards.length ?? 0).toBeLessThanOrEqual(
      MAX_SEMANTIC_SECTION_CARDS
    );
  });
});
