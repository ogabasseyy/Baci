import {
  normalizeProductVariants,
  transformProduct,
} from './product-transform';

const variantProductRow = {
  id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
  name: 'Samsung Galaxy A27 5G Preorder',
  slug: 'samsung-galaxy-a27-5g',
  description: 'Preorder listing',
  price: 50000,
  compare_at_price: null,
  created_at: '2026-06-24T08:00:00.000Z',
  images: [],
  brand: 'Samsung',
  condition: 'new',
  average_rating: 0,
  review_count: 0,
  manage_stock: false,
  stock: 0,
  stock_quantity: 0,
  status: 'active',
  specifications: {
    RAM: '6GB / 8GB',
  },
  has_variants: true,
  variant_model: 'sku_matrix',
  available_conditions: ['new'],
  variant_attributes: [
    { param: 'color', options: ['Blue'] },
    { param: 'storage', options: ['128GB', '256GB'] },
  ],
  variants: [
    {
      id: 'variant-blue-256',
      product_id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
      merchant_id: 'merchant-1',
      condition: 'new',
      sku: 'SAMSUNG-A27-5G-PREORDER-BLUE-256GB',
      price_override: 50000,
      primary_image: null,
      images: [],
      stock_quantity: 0,
      attributes: {
        ram: '8GB',
        color: 'Blue',
        storage: '256GB',
        preorder: true,
        color_hex: '#6B86B5',
      },
    },
  ],
  categories: [{ id: 'cat-1', name: 'Smartphones', slug: 'smartphones' }],
};

describe('product-transform', () => {
  it('carries serialized policy and units through variant normalization', () => {
    const product = transformProduct({
      ...variantProductRow,
      variants: [
        {
          ...variantProductRow.variants[0],
          effective_policy: 'serialized_strict',
          available_units: 3,
        },
      ],
    });
    expect(product?.variants).toEqual([
      expect.objectContaining({
        effective_policy: 'serialized_strict',
        available_units: 3,
      }),
    ]);
  });

  it('carries hydrated base policy and units onto simple products', () => {
    const product = transformProduct({
      ...variantProductRow,
      has_variants: false,
      variant_model: 'legacy',
      variants: [],
      base_effective_policy: 'serialized_strict',
      base_available_units: 4,
    });
    expect(product).toEqual(
      expect.objectContaining({
        base_effective_policy: 'serialized_strict',
        base_available_units: 4,
      })
    );
  });

  it('normalizes live variant attributes to selector strings only', () => {
    expect(
      normalizeProductVariants(variantProductRow.variants, {
        basePrice: variantProductRow.price,
        manageStock: variantProductRow.manage_stock,
      })
    ).toEqual([
      expect.objectContaining({
        attributes: {
          ram: '8GB',
          color: 'Blue',
          storage: '256GB',
          color_hex: '#6B86B5',
        },
        in_stock: true,
        name: '256GB 8GB Blue',
        price: 50000,
      }),
    ]);
  });

  it('drops malformed product and variant payloads safely', () => {
    expect(
      normalizeProductVariants({ not: 'an array' }, { basePrice: 1000 })
    ).toEqual([]);

    expect(transformProduct({ ...variantProductRow, id: null })).toBeNull();
  });

  it('transforms live preorder products without keeping boolean variant metadata', () => {
    const product = transformProduct(variantProductRow);

    expect(product).toMatchObject({
      name: 'Samsung Galaxy A27 5G Preorder',
      slug: 'samsung-galaxy-a27-5g',
      created_at: '2026-06-24T08:00:00.000Z',
      variants: [
        expect.objectContaining({
          attributes: {
            ram: '8GB',
            color: 'Blue',
            storage: '256GB',
            color_hex: '#6B86B5',
          },
          price: 50000,
        }),
      ],
    });
    expect(product?.variants?.[0]?.attributes).not.toHaveProperty('preorder');
  });

  it('keeps listing text and images usable before variant details arrive', () => {
    const product = transformProduct({
      ...variantProductRow,
      variants: undefined,
      images: ['https://example.com/phone.jpg'],
    });
    expect(product).toMatchObject({
      name: variantProductRow.name,
      price: 50000,
      has_variants: true,
      image: 'https://example.com/phone.jpg',
      variants: [],
    });
  });

  it('treats null manage_stock as managed inventory', () => {
    const product = transformProduct({
      ...variantProductRow,
      manage_stock: null,
      stock: 0,
      stock_quantity: 0,
    });

    expect(product).toMatchObject({
      manage_stock: true,
      in_stock: false,
      variants: [expect.objectContaining({ in_stock: false })],
    });
  });

  it('keeps null manage_stock purchasable when stock exists', () => {
    const product = transformProduct({
      ...variantProductRow,
      manage_stock: null,
      stock: 3,
      stock_quantity: 3,
    });

    expect(product).toMatchObject({
      manage_stock: true,
      in_stock: true,
    });
  });

  it('treats sku_matrix products as variant-bearing when has_variants has drifted false', () => {
    const product = transformProduct({
      ...variantProductRow,
      has_variants: false,
    });

    expect(product).toMatchObject({
      has_variants: true,
      variant_model: 'sku_matrix',
      variants: [expect.objectContaining({ id: 'variant-blue-256' })],
    });
  });
});
