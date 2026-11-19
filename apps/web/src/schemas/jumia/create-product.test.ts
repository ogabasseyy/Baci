import { describe, expect, it } from 'vitest';
import { JumiaCreateProductSchema } from './create-product';

// Sanitized Create Products example; verified 2026-10-24:
// https://vendorcenter.jumia.com/api-docs/paths/feeds/feeds@products@create.yaml
const product = {
  name: { value: 'Synthetic gaming controller' },
  description: { value: 'Synthetic product description, not tenant data.' },
  parentSku: ' SKU/+&=? Exact ',
  sellerSku: ' SKU/+&=? Exact ',
  variation: '...',
  brand: { code: 1126253, name: 'Controller brand' },
  category: { code: 1004141, name: 'Gaming / Accessories / Controllers' },
  images: [{ url: 'https://example.com/controller.jpg', primary: true }],
  price: { currency: 'NGN', value: 20000 },
  stock: 0,
  attributes: [
    { name: 'model', value: ' Model/+&=? Exact ' },
    { name: 'short_description', value: '<ul><li>Plain fixture</li></ul>' },
  ],
};

describe('Create Products flat outbound contract', () => {
  it('preserves exact SKUs, attribute bytes and content without defaults', () => {
    expect(JumiaCreateProductSchema.parse(product)).toEqual(product);
  });

  it('preserves documented optional translations, barcode and local prices', () => {
    const populated = {
      ...product,
      name: {
        ...product.name,
        translations: [{ language: 'FR', value: 'Jeu' }],
      },
      description: {
        ...product.description,
        translations: [{}, { language: 'FR' }],
      },
      gtinBarcode: '000123456001234570',
      additionalCategories: [{ code: 1004142, name: 'Gaming' }, {}],
      price: {
        currency: 'USD',
        value: 200,
        salePrice: { value: 150, startAt: '2022-08-11', endAt: '2022-08-22' },
      },
      businessClients: [
        {
          businessClientCode: 'jumia-ng',
          price: { currency: 'NGN', value: 20000, salePrice: null },
        },
        {
          businessClientCode: 'jumia-eg',
          price: {
            currency: 'EGP',
            value: 22000,
            salePrice: { value: null, startAt: null, endAt: null },
          },
        },
      ],
      attributes: [
        {
          name: 'model',
          value: 'Test model',
          translations: [{ value: 'Modele' }],
        },
      ],
      providerMetadata: { revision: 3 },
    };
    expect(JumiaCreateProductSchema.parse(populated)).toEqual(populated);
  });

  it('does not invent optional sale fields or business-client metadata', () => {
    const sparse = {
      ...product,
      price: { ...product.price, salePrice: {} },
      businessClients: [{}, { price: { salePrice: {} } }],
    };
    expect(JumiaCreateProductSchema.parse(sparse)).toEqual(sparse);
  });

  it('accepts a flat record per SKU without a nested variations container', () => {
    const second = { ...product, sellerSku: 'controller-two', variation: '2' };
    expect(JumiaCreateProductSchema.parse(second)).toEqual(second);
    expect(JumiaCreateProductSchema.parse(product).parentSku).toBe(
      ' SKU/+&=? Exact '
    );
  });

  it.each([
    'name',
    'description',
    'parentSku',
    'sellerSku',
    'variation',
    'brand',
    'category',
    'images',
    'price',
    'stock',
    'attributes',
  ])('rejects missing required product field %s', (field) => {
    expect(
      JumiaCreateProductSchema.safeParse({ ...product, [field]: undefined })
        .success
    ).toBe(false);
  });

  it.each([
    { name: {} },
    { name: { value: 15 } },
    { name: { value: '' } },
    { description: {} },
    { description: { value: false } },
    { description: { value: '' } },
    { parentSku: '' },
    { parentSku: 1 },
    { sellerSku: '' },
    { sellerSku: 1 },
    { variation: '' },
    { variation: 1 },
    { brand: { code: '1126253', name: 'Brand' } },
    { brand: { code: 1126253 } },
    { brand: { name: 'Brand' } },
    { brand: { code: 1126253, name: false } },
    { category: { code: '1004141', name: 'Controllers' } },
    { category: { code: 1004141 } },
    { category: { name: 'Controllers' } },
    { category: { code: 1004141, name: '' } },
    { price: { value: 1 } },
    { price: { currency: 'NGN' } },
    { price: { currency: '', value: 1 } },
    { price: { currency: 1, value: 1 } },
    { attributes: [{ id: 'legacy-id', value: 'Black' }] },
    { attributes: [{ name: 'color' }] },
    { attributes: [{ name: 1, value: 'Black' }] },
    { attributes: [{ name: 'color', value: 1 }] },
    { images: [{ url: 'https://example.com/image.jpg' }] },
    { images: [{ primary: true }] },
    { images: [{ url: 'not-a-uri', primary: true }] },
    { images: [{ url: 'https://example.com/image.jpg', primary: 'true' }] },
  ])('rejects malformed required flat fields %j', (change) => {
    expect(
      JumiaCreateProductSchema.safeParse({ ...product, ...change }).success
    ).toBe(false);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    '200',
  ])('rejects unsafe outbound price %s', (value) => {
    expect(
      JumiaCreateProductSchema.safeParse({
        ...product,
        price: { currency: 'NGN', value },
      }).success
    ).toBe(false);
  });

  it.each([
    { stock: Number.MAX_SAFE_INTEGER, accepted: true },
    { stock: Number.MAX_SAFE_INTEGER + 1, accepted: false },
  ])('enforces the safe-integer stock boundary (%j)', ({ stock, accepted }) => {
    expect(
      JumiaCreateProductSchema.safeParse({ ...product, stock }).success
    ).toBe(accepted);
  });

  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    '0',
    null,
  ])('rejects nonrepresentable stock %s', (stock) => {
    expect(
      JumiaCreateProductSchema.safeParse({ ...product, stock }).success
    ).toBe(false);
  });

  it.each([
    { images: null },
    { images: {} },
    { images: [] },
    { images: [{ url: 'https://example.com/image.jpg', primary: false }] },
    { images: [product.images[0], product.images[0]] },
    { attributes: {} },
    { attributes: null },
    { attributes: [null] },
    { businessClients: {} },
    { businessClients: [null] },
    { businessClients: [{ businessClientCode: 1 }] },
    { businessClients: [{ price: { currency: 1 } }] },
    { businessClients: [{ price: { value: Number.NaN } }] },
    { businessClients: [{ price: { value: -1 } }] },
    { businessClients: [{ price: { salePrice: { value: '10' } } }] },
    { businessClients: [{ price: { salePrice: { startAt: false } } }] },
    { price: { ...product.price, salePrice: null } },
    {
      price: {
        ...product.price,
        salePrice: { value: Number.POSITIVE_INFINITY },
      },
    },
    { name: { value: product.name.value, translations: {} } },
    { name: { value: product.name.value, translations: [{ language: 1 }] } },
    {
      attributes: [
        { name: 'model', value: 'Test', translations: [{ value: 1 }] },
      ],
    },
    { additionalCategories: [{ code: '1004142' }] },
    { gtinBarcode: 123 },
  ])('rejects malformed arrays and optional wire fields %j', (change) => {
    expect(
      JumiaCreateProductSchema.safeParse({ ...product, ...change }).success
    ).toBe(false);
  });

  it.each([
    {
      ...product,
      variations: [{ sellerSku: 'legacy', globalPrice: { value: 200 } }],
    },
    { ...product, variations: [] },
    { ...product, globalPrice: { currency: 'USD', value: 200 } },
    {
      name: product.name,
      brand: product.brand,
      category: { code: 1004141 },
      variations: [],
    },
  ])('rejects legacy nested/globalPrice create shapes', (legacy) => {
    expect(JumiaCreateProductSchema.safeParse(legacy).success).toBe(false);
  });
});
