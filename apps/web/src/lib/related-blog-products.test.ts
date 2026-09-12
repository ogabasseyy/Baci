import { describe, expect, it } from 'vitest';
import {
  normalizeRelatedBlogProductLinks,
  normalizeRelatedBlogProducts,
  RELATED_BLOG_PRODUCT_LINKS_SELECT,
  RELATED_BLOG_PRODUCTS_SELECT,
} from '@/lib/related-blog-products';

describe('related blog products', () => {
  it('selects the canonical product category relation instead of a missing legacy column', () => {
    expect(RELATED_BLOG_PRODUCTS_SELECT).toContain(
      'categories:category_id!inner(slug)'
    );
    expect(RELATED_BLOG_PRODUCTS_SELECT).toContain(
      'price, compare_at_price, min_variant_price, max_variant_price, stock, stock_quantity, manage_stock'
    );
    expect(RELATED_BLOG_PRODUCTS_SELECT).toContain('has_condition_offers');
    expect(RELATED_BLOG_PRODUCTS_SELECT).toContain('has_variants');
    expect(RELATED_BLOG_PRODUCT_LINKS_SELECT).toContain(
      'products!blog_post_products_product_id_fkey'
    );
    expect(RELATED_BLOG_PRODUCT_LINKS_SELECT).toContain(
      'price, compare_at_price, min_variant_price, max_variant_price, stock, stock_quantity, manage_stock'
    );
    expect(RELATED_BLOG_PRODUCT_LINKS_SELECT).toContain('has_condition_offers');
    expect(RELATED_BLOG_PRODUCT_LINKS_SELECT).toContain('has_variants');
    expect(RELATED_BLOG_PRODUCTS_SELECT).not.toMatch(/\bcategory_slug\b/);
  });

  it('projects the joined category slug into the blog product link shape', () => {
    expect(
      normalizeRelatedBlogProducts([
        {
          id: 'product-1',
          name: 'Laptop',
          price: 150000,
          manage_stock: true,
          stock: 3,
          slug: 'laptop',
          categories: { slug: 'laptops' },
        },
      ])
    ).toEqual([
      {
        id: 'product-1',
        name: 'Laptop',
        price: 150000,
        manage_stock: true,
        stock: 3,
        slug: 'laptop',
        category_slug: 'laptops',
      },
    ]);
  });

  it('handles absent and collection category relation results', () => {
    expect(normalizeRelatedBlogProducts(null)).toEqual([]);
    expect(normalizeRelatedBlogProducts(undefined)).toEqual([]);
    expect(
      normalizeRelatedBlogProducts([
        {
          id: 'product-1',
          name: 'Uncategorized',
          slug: 'uncategorized',
          categories: [],
        },
        {
          id: 'product-2',
          name: 'Missing slug',
          slug: 'missing-slug',
          categories: { slug: null },
        },
        {
          id: 'product-3',
          name: 'Multi relation',
          slug: 'multi-relation',
          categories: [{ slug: 'laptops' }, { slug: 'electronics' }],
        },
      ])
    ).toEqual([
      {
        id: 'product-1',
        name: 'Uncategorized',
        slug: 'uncategorized',
        category_slug: null,
      },
      {
        id: 'product-2',
        name: 'Missing slug',
        slug: 'missing-slug',
        category_slug: null,
      },
      {
        id: 'product-3',
        name: 'Multi relation',
        slug: 'multi-relation',
        category_slug: 'laptops',
      },
    ]);
  });

  it('projects explicit blog product links and ignores inactive linked products', () => {
    expect(
      normalizeRelatedBlogProductLinks([
        {
          product: {
            id: 'product-1',
            name: 'iPad 10th Gen',
            slug: 'ipad-10th-gen-2022',
            status: 'active',
            categories: { slug: 'tablets' },
          },
        },
        {
          product: {
            id: 'product-2',
            name: 'Inactive iPad',
            slug: 'inactive-ipad',
            status: 'draft',
            categories: { slug: 'tablets' },
          },
        },
      ])
    ).toEqual([
      {
        id: 'product-1',
        name: 'iPad 10th Gen',
        slug: 'ipad-10th-gen-2022',
        category_slug: 'tablets',
      },
    ]);
  });
});
