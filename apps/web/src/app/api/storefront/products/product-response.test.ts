import { describe, expect, it } from 'vitest';
import type { RawDbProduct } from '@/lib/normalize-product';
import {
  mapStorefrontProduct,
  STOREFRONT_PRODUCTS_COMPACT_SELECT,
  STOREFRONT_PRODUCTS_FULL_SELECT,
} from './product-response';

/**
 * Parse a Supabase select fragment string into top-level tokens so tests can
 * assert exact field membership instead of relying on brittle substring checks.
 *
 * Strips nested `relation(...)` parens so top-level relation aliases like
 * `categories:category_id(id, name)` are preserved but their inner fields are
 * removed, and the result is a flat list of top-level tokens separated by
 * commas (ignoring whitespace/newlines).
 */
function parseSelectTokens(fragment: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of fragment) {
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === ',' && depth === 0) {
      const token = current.trim();
      if (token) {
        tokens.push(token);
      }
      current = '';
      continue;
    }
    // Only collect characters at the top level so nested relation fields
    // (e.g. `product_categories (categories (id, name, slug))`) do not leak
    // inner fields into the top-level token list.
    if (depth === 0) {
      current += char;
    }
  }

  const trailing = current.trim();
  if (trailing) {
    tokens.push(trailing);
  }

  return tokens;
}

describe('product-response', () => {
  it('includes canonical storefront select fragments', () => {
    const fullTokens = parseSelectTokens(STOREFRONT_PRODUCTS_FULL_SELECT);
    const compactTokens = parseSelectTokens(STOREFRONT_PRODUCTS_COMPACT_SELECT);

    expect(fullTokens).not.toContain('*');
    expect(fullTokens).not.toContain('colors');
    expect(fullTokens).toContain('category_id');
    expect(STOREFRONT_PRODUCTS_FULL_SELECT).toContain('product_key_specs (');
    expect(STOREFRONT_PRODUCTS_FULL_SELECT).not.toMatch(
      /,\s*product_key_specs\s*,/
    );
    // `product_categories` is an aliased relation like
    // `product_categories:product_categories(...)` — strip the alias if present.
    const normalize = (token: string) => token.split(':')[0].trim();
    expect(fullTokens.map(normalize)).toContain('product_categories');

    expect(compactTokens).toContain('image_hint');
    // `categories:category_id(...)` is a top-level relation alias.
    expect(compactTokens).toContain('categories:category_id');
  });

  it('maps storefront product images and defaults consistently', () => {
    const rawProduct: RawDbProduct = {
      id: 'product-1',
      name: 'Samsung Galaxy Z Fold',
      price: 1800000,
      stock: 7,
      category_id: 'cat-1',
      categories: {
        id: 'cat-1',
        name: 'Smartphones',
        slug: 'smartphones',
      },
      images: [
        'https://cdn.example.com/fold-front.png',
        {
          url: 'https://cdn.example.com/fold-back.png',
          alt: 'Rear angle',
          order: 7,
        },
        { alt: 'Missing URL' },
      ],
      color_images: {
        Black: 'https://cdn.example.com/black.png',
        Silver: 'https://cdn.example.com/silver.png',
      },
    };

    const mapped = mapStorefrontProduct(rawProduct);

    expect(mapped.manage_stock).toBe(false);
    expect(mapped.inventory_policy).toBe('untracked');
    expect(mapped.is_purchasable).toBe(true);
    expect(mapped.quantity_available).toBeNull();
    expect(mapped.brand).toBe('');
    expect(mapped.category_id).toBe('cat-1');
    expect(mapped.categories).toEqual({
      id: 'cat-1',
      name: 'Smartphones',
      slug: 'smartphones',
    });
    expect(mapped.colors).toEqual(['Black', 'Silver']);
    expect(mapped.images).toEqual([
      {
        url: 'https://cdn.example.com/fold-front.png',
        alt: 'Samsung Galaxy Z Fold',
        order: 0,
      },
      {
        url: 'https://cdn.example.com/fold-back.png',
        alt: 'Rear angle',
        order: 7,
      },
      {
        url: '',
        alt: 'Missing URL',
        order: 2,
      },
    ]);
  });

  it('preserves explicit manage_stock=false when set on the product', () => {
    const rawProduct: RawDbProduct = {
      id: 'product-unmanaged',
      name: 'Infinite Stock Item',
      price: 1000,
      stock: 0,
      images: [],
      manage_stock: false,
    };

    const mapped = mapStorefrontProduct(rawProduct);

    expect(mapped.manage_stock).toBe(false);
    expect(mapped.availability).toBe('in_stock');
    expect(mapped.inventory_policy).toBe('untracked');
    expect(mapped.is_purchasable).toBe(true);
    expect(mapped.quantity_available).toBeNull();
  });

  it('treats nullable manage_stock as unmanaged stock', () => {
    const rawProduct: RawDbProduct = {
      id: 'product-null-stock',
      name: 'Legacy Infinite Stock Item',
      price: 1000,
      stock: 0,
      stock_quantity: 0,
      images: [],
      manage_stock: null,
    };

    const mapped = mapStorefrontProduct(rawProduct);

    expect(mapped.manage_stock).toBe(false);
    expect(mapped.availability).toBe('in_stock');
    expect(mapped.inventory_policy).toBe('untracked');
    expect(mapped.is_purchasable).toBe(true);
    expect(mapped.quantity_available).toBeNull();
  });

  it('derives colors from color_images keys', () => {
    const rawProduct: RawDbProduct = {
      id: 'product-2',
      name: 'MacBook Pro',
      price: 2500000,
      stock: 3,
      category: 'Laptops',
      images: ['https://cdn.example.com/macbook.png'],
      color_images: {
        Midnight: 'https://cdn.example.com/midnight.png',
        Silver: 'https://cdn.example.com/silver.png',
      },
    };

    const mapped = mapStorefrontProduct(rawProduct);

    expect(mapped.colors).toEqual(['Midnight', 'Silver']);
  });

  it('ignores non-object color_images values', () => {
    const rawProduct: RawDbProduct = {
      id: 'product-color-array',
      name: 'Invalid Color Images',
      price: 150000,
      stock: 3,
      category: 'Accessories',
      images: ['https://cdn.example.com/accessory.png'],
      color_images: ['Red'] as unknown as RawDbProduct['color_images'],
    };

    const mapped = mapStorefrontProduct(rawProduct);

    expect(mapped.colors).toEqual([]);
  });

  it('derives colors from the supported single color column', () => {
    const rawProduct: RawDbProduct = {
      id: 'product-3',
      name: 'iPhone 15',
      price: 1200000,
      stock: 2,
      category: 'Smartphones',
      images: ['https://cdn.example.com/iphone.png'],
      color: 'Blue',
    };

    const mapped = mapStorefrontProduct(rawProduct);

    expect(mapped.colors).toEqual(['Blue']);
  });

  it('returns an empty color list when no color sources exist', () => {
    const rawProduct: RawDbProduct = {
      id: 'product-4',
      name: 'USB-C Charger',
      price: 35000,
      stock: 4,
      category: 'Accessories',
      images: ['https://cdn.example.com/charger.png'],
    };

    const mapped = mapStorefrontProduct(rawProduct);

    expect(mapped.colors).toEqual([]);
  });

  it('preserves InStock availability, purchasability, and projected gallery image when advertised variant is in stock despite parent zero stock', () => {
    const rawProduct: RawDbProduct = {
      id: 'phone-managed-variant',
      name: 'iPhone 16 Pro',
      price: 1500000,
      advertised_price: 1650000,
      advertised_image: 'https://cdn.example.com/phone-cellular.png',
      stock: 0,
      stock_quantity: 0,
      manage_stock: true,
      availability: 'InStock',
      category: 'Smartphones',
      images: ['https://cdn.example.com/phone.png'],
    };

    const mapped = mapStorefrontProduct(rawProduct);

    expect(mapped.availability).toBe('in_stock');
    expect(mapped.is_purchasable).toBe(true);
    expect(mapped.quantity_available).toBe(1);
    expect(mapped.stock).toBe(1);
    expect(mapped.images[0]?.url).toBe(
      'https://cdn.example.com/phone-cellular.png'
    );
  });
});
