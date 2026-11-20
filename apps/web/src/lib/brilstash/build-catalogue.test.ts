import { describe, expect, it } from 'vitest';
import {
  buildBrilStashCatalogue,
  type SellableSource,
} from './build-catalogue';
import { catalogueFixture } from './build-catalogue.test-fixture';

const { base, context, facts } = catalogueFixture;
const sources = [
  {
    ...base,
    kind: 'product',
    id: 'accessory',
    productUrl: 'https://shop.example.invalid/accessory',
    condition: 'new',
  },
  {
    ...base,
    kind: 'variant',
    id: 'new-128',
    productUrl: 'https://shop.example.invalid/phone?campaign=pilot',
    condition: 'new',
  },
  {
    ...base,
    kind: 'variant',
    id: 'new-256',
    productUrl: 'https://shop.example.invalid/phone',
    condition: 'new',
    inventory: { kind: 'quantity', units: 0 },
  },
  {
    ...base,
    kind: 'variant',
    id: 'used-128',
    productUrl: 'https://shop.example.invalid/phone',
    condition: 'uk_used',
  },
  {
    ...base,
    kind: 'product',
    id: 'laptop',
    productUrl: 'https://shop.example.invalid/laptop',
    condition: 'new',
  },
  {
    ...base,
    kind: 'offer',
    id: 'laptop-open',
    productUrl: 'https://shop.example.invalid/laptop?offer_id=stale',
    condition: 'open_box',
    approvedFacts: { ...facts, boxContents: 'Laptop only', warranty: '7 days' },
  },
  {
    ...base,
    kind: 'product',
    id: 'tablet',
    productUrl: 'https://shop.example.invalid/tablet',
    condition: 'new',
    inventory: { kind: 'serialized', units: 0 },
  },
] as const satisfies readonly SellableSource[];
const categoryMap = new Map([['phones', 'Test category']]);
const build = (rows: readonly SellableSource[] = sources) =>
  buildBrilStashCatalogue(
    context,
    rows,
    new Map(
      sources.map((row) => [`${row.kind}:${row.id}`, `listing-${row.id}`])
    ),
    categoryMap
  );

describe('buildBrilStashCatalogue', () => {
  it('exports the seven approved sellables with exact links, condition and stock', () => {
    const { products, rejected } = build();
    expect(rejected).toEqual([]);
    expect(products.map((p) => p.external_id)).toEqual([
      'listing-accessory',
      'listing-laptop',
      'listing-laptop-open',
      'listing-new-128',
      'listing-new-256',
      'listing-tablet',
      'listing-used-128',
    ]);
    const byId = new Map(products.map((p) => [p.external_id, p]));
    expect(byId.get('listing-new-128')).toMatchObject({
      price_naira: 350000,
      stock_quantity: 2,
      product_url:
        'https://shop.example.invalid/phone?campaign=pilot&variantId=new-128&condition=new',
    });
    expect(byId.get('listing-new-256')?.stock_quantity).toBe(0);
    expect(byId.get('listing-tablet')?.stock_quantity).toBe(0);
    expect(byId.get('listing-used-128')?.description).toContain(
      'Condition: UK Used'
    );
    expect(byId.get('listing-laptop-open')).toMatchObject({
      product_url:
        'https://shop.example.invalid/laptop?offer_id=laptop-open&condition=open_box',
      description:
        'Condition: Open Box. Specifications: 128 GB. Box contents: Laptop only. Warranty: 7 days.',
    });
  });

  it('exports the canonical product URL without a browser fragment', () => {
    const productUrl =
      'https://shop.example.invalid/phone?campaign=pilot#reviews';
    const { products } = build([{ ...sources[1], productUrl }]);
    expect(products[0]?.product_url).toBe(
      'https://shop.example.invalid/phone?campaign=pilot&variantId=new-128&condition=new'
    );
  });

  it('exports distinct offers for the same normalized condition', () => {
    const offer = sources[5];
    const alternateOffer = {
      ...offer,
      id: 'laptop-open-2',
      priceNaira: 340000,
    };
    const { rejected, products } = buildBrilStashCatalogue(
      context,
      [offer, alternateOffer],
      new Map([
        ['offer:laptop-open', 'listing-one'],
        ['offer:laptop-open-2', 'listing-two'],
      ]),
      categoryMap
    );
    expect(rejected).toEqual([]);
    expect(products).toMatchObject([
      {
        price_naira: offer.priceNaira,
        product_url:
          'https://shop.example.invalid/laptop?offer_id=laptop-open&condition=open_box',
      },
      {
        price_naira: alternateOffer.priceNaira,
        product_url:
          'https://shop.example.invalid/laptop?offer_id=laptop-open-2&condition=open_box',
      },
    ]);
  });

  it('preserves listing identity when only price changes', () => {
    const changed = build([{ ...sources[1], priceNaira: 365000 }]);
    expect(changed.products).toMatchObject([
      { external_id: 'listing-new-128', price_naira: 365000 },
    ]);
  });

  it('selects unique HTTPS images in order, with ten total', () => {
    const images = Array.from(
      { length: 12 },
      (_, i) => `https://images.example.invalid/${i}.jpg`
    );
    expect(
      build([
        {
          ...sources[0],
          verifiedImages: [images[0], ...images],
        },
      ]).products[0]?.images
    ).toEqual(images.slice(0, 10).map((url) => ({ url })));
  });

  it('canonicalizes the product authority and preserves the exact verified image authority', () => {
    const provisioned = 'https://IMAGES.example.invalid.:443/phone.jpg';
    const { products } = build([
      {
        ...sources[0],
        productUrl: 'https://SHOP.example.invalid:443/phone',
        verifiedImages: [
          provisioned,
          provisioned,
          'https://images.example.invalid/phone.jpg',
          'https://images.example.invalid/secondary.jpg',
        ],
      },
    ]);
    expect(products[0]?.product_url).toBe('https://shop.example.invalid/phone');
    expect(products[0]?.images).toEqual([
      { url: provisioned },
      { url: 'https://images.example.invalid/secondary.jpg' },
    ]);
  });

  it('rejects a source with a malformed verified URL even if other images are valid', () => {
    expect(
      build([
        {
          ...sources[0],
          verifiedImages: [
            ...sources[0].verifiedImages,
            'https://images.example.invalid:65536/bad.jpg',
          ],
        },
      ]).rejected
    ).toEqual([{ sourceRef: 'product:accessory', code: 'missing_images' }]);
  });

  it.each([
    [{ merchantId: 'other' }, 'wrong_scope'],
    [{ installationId: 'other' }, 'wrong_scope'],
    [{ visible: false }, 'not_sellable'],
    [{ condition: null }, 'unknown_condition'],
    [{ inventory: { kind: 'untracked' } }, 'unavailable_stock'],
    [{ inventory: { kind: 'serialized', units: null } }, 'unavailable_stock'],
    [
      { inventory: { kind: 'quantity', units: 0, legacyUnits: 5 } },
      'unavailable_stock',
    ],
    [{ currency: 'USD' }, 'invalid_price'],
    [{ priceNaira: Number.POSITIVE_INFINITY }, 'invalid_price'],
    [{ priceNaira: 0.001 }, 'invalid_price'],
    [{ approvedFacts: null }, 'missing_facts'],
    [{ approvedFacts: { ...facts, warranty: '<b></b>' } }, 'missing_facts'],
    [{ productUrl: 'https://elsewhere.example.invalid/p' }, 'invalid_url'],
    [
      { verifiedImages: ['http://images.example.invalid/image'] },
      'missing_images',
    ],
    [{ categoryId: 'unmapped' }, 'unmapped_category'],
  ] satisfies [
    Partial<SellableSource>,
    string,
  ][])('rejects %j as %s', (change, code) => {
    expect(build([{ ...sources[0], ...change } as SellableSource])).toEqual({
      products: [],
      rejected: [{ sourceRef: 'product:accessory', code }],
    });
  });

  it('rejects unapproved source IDs and excludes internal inventory anchors', () => {
    expect(build([{ ...sources[1], id: 'unapproved' }]).rejected[0]?.code).toBe(
      'unapproved_source'
    );
    expect(
      build([{ ...sources[1], is_inventory_anchor: true }]).rejected[0]?.code
    ).toBe('not_sellable');
  });

  it('rejects a redundant legacy primary offer and duplicate unqualified selections', () => {
    const primary = {
      ...sources[5],
      condition: 'new',
      parentCondition: 'new',
    } as const;
    expect(build([primary]).rejected[0]?.code).toBe('not_sellable');
    const duplicates = build([
      { ...sources[0], productUrl: sources[4].productUrl, condition: 'used' },
      sources[4],
    ]);
    expect(duplicates.products).toEqual([]);
    expect(duplicates.rejected).toEqual([
      { sourceRef: 'product:accessory', code: 'ambiguous_selection' },
      { sourceRef: 'product:laptop', code: 'ambiguous_selection' },
    ]);
  });
});

it('exports only zero for a reviewed stock withdrawal and excludes a private source', () => {
  const source = {
    ...sources[0],
    inventory: {
      kind: 'withdrawn',
      units: 0,
      approvalId: 'a0000000-0000-4000-8000-000000000001',
    },
  } as const;
  const identities = new Map([
    [`${source.kind}:${source.id}`, 'prior-listing'],
  ]);
  const categories = new Map([['phones', 'Phones']]);
  expect(
    buildBrilStashCatalogue(context, [source], identities, categories).products
  ).toEqual([
    expect.objectContaining({
      external_id: 'prior-listing',
      stock_quantity: 0,
    }),
  ]);
  expect(
    buildBrilStashCatalogue(
      context,
      [{ ...source, visible: false }],
      identities,
      categories
    ).products
  ).toEqual([]);
});
