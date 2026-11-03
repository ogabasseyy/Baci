import { describe, expect, it } from 'vitest';
import {
  normalizeCategoryPageProducts,
  toClientCategoryPageProducts,
} from './category-page-content-helpers';

describe('normalizeCategoryPageProducts', () => {
  it('uses the route category slug for multi-category products', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-1',
          name: 'Galaxy Z Fold',
          slug: 'galaxy-z-fold',
          description: 'Foldable phone',
          price: 1200000,
          condition: 'new',
          stock: 4,
          images: ['https://cdn.example.com/fold.png'],
          categories: [
            {
              name: 'Featured',
              slug: 'featured',
            },
            {
              name: 'Smartphones',
              slug: 'smartphones',
            },
          ],
          product_key_specs: {
            ram_gb: 12,
            storage_gb: 512,
          },
        },
      ],
      'smartphones'
    );

    expect(result.category).toBe('Smartphones');
    expect(result.category_slug).toBe('smartphones');
  });

  it('keeps the first category when it already matches the route category', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-2',
          name: 'iPhone 16',
          slug: 'iphone-16',
          description: 'Flagship phone',
          price: 1500000,
          condition: 'new',
          stock: 8,
          images: ['https://cdn.example.com/iphone-16.png'],
          categories: [{ name: 'Smartphones', slug: 'smartphones' }],
        },
      ],
      'smartphones'
    );

    expect(result.category).toBe('Smartphones');
    expect(result.category_slug).toBe('smartphones');
  });

  it('falls back to the first available category when the route category is absent', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-3',
          name: 'Galaxy Book',
          slug: 'galaxy-book',
          description: 'Windows laptop',
          price: 1750000,
          condition: 'new',
          stock: 5,
          images: ['https://cdn.example.com/galaxy-book.png'],
          categories: [
            { name: 'Laptops', slug: 'laptops' },
            { name: 'Featured', slug: 'featured' },
          ],
        },
      ],
      'smartphones'
    );

    expect(result.category).toBe('Laptops');
    expect(result.category_slug).toBe('laptops');
  });

  it('returns an empty array when there are no products to normalize', () => {
    expect(normalizeCategoryPageProducts([], 'smartphones')).toEqual([]);
  });

  it('formats normalized product prices with the storefront country currency', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-4',
          name: 'Kurta Set',
          slug: 'kurta-set',
          description: 'Festive wear',
          price: 2500,
          condition: 'new',
          stock: 7,
          images: ['https://cdn.example.com/kurta.png'],
          categories: [{ name: 'Fashion', slug: 'fashion' }],
        },
      ],
      'fashion',
      'IN'
    );

    expect(result.price).toMatch(/₹|INR/);
    expect(result.price).not.toContain('₦');
  });

  it('falls back to NGN when no storefront country is provided', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-5',
          name: 'Classic Tote',
          slug: 'classic-tote',
          description: 'Everyday bag',
          price: 2500,
          condition: 'new',
          stock: 3,
          images: ['https://cdn.example.com/tote.png'],
          categories: [{ name: 'Fashion', slug: 'fashion' }],
        },
      ],
      'fashion'
    );

    expect(result.price).toContain('₦');
    expect(result.price).not.toMatch(/₹|INR/);
  });

  it('falls back to NGN when the storefront country is null', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-6',
          name: 'Travel Backpack',
          slug: 'travel-backpack',
          description: 'Carry-on friendly backpack',
          price: 4500,
          condition: 'new',
          stock: 6,
          images: ['https://cdn.example.com/backpack.png'],
          categories: [{ name: 'Bags', slug: 'bags' }],
        },
      ],
      'bags',
      null
    );

    expect(result.price).toContain('₦');
    expect(result.price).not.toContain('$');
  });

  it('surfaces the GPU spec as the category graphics filter value', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-7',
          name: 'Gaming Laptop',
          slug: 'gaming-laptop',
          description: 'RTX laptop',
          price: 1750000,
          condition: 'used',
          stock: 0,
          images: ['https://cdn.example.com/gaming-laptop.png'],
          categories: [{ name: 'Gaming Laptops', slug: 'gaming-laptops' }],
          product_key_specs: {
            gpu: 'NVIDIA RTX 4070',
          },
        },
      ],
      'gaming-laptops'
    );

    expect(result.graphics).toBe('NVIDIA RTX 4070');
  });

  it('preserves created_at timestamps through category normalization and client projection', () => {
    const normalized = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-8',
          name: 'Pixel 11 Pro',
          slug: 'pixel-11-pro',
          description: 'Flagship phone',
          price: 1450000,
          created_at: '2026-10-30T12:00:00.000Z',
          condition: 'new',
          stock: 5,
          images: ['https://cdn.ogabassey.com/pixel-11-pro.avif'],
          categories: [{ name: 'Smartphones', slug: 'smartphones' }],
        },
      ],
      'smartphones'
    );

    expect(normalized[0]?.created_at).toBe('2026-10-30T12:00:00.000Z');
    const clientProjected = toClientCategoryPageProducts(normalized);
    expect(clientProjected[0]?.created_at).toBe('2026-10-30T12:00:00.000Z');
  });
});
