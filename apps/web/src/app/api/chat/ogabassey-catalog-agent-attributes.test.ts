import { describe, expect, it } from 'vitest';
import type { StorefrontAgentUiProduct } from '@/schemas/storefront-agent-ui-contract';
import { hasGroundedSpecAndPolicyClaims } from './ogabassey-catalog-agent-attributes';

const baseProduct: StorefrontAgentUiProduct = {
  brand: 'Apple',
  category: 'Laptops',
  description: 'Apple MacBook Air M2 with 1080p webcam and 4K display support',
  hasVariants: false,
  id: 'mac-1',
  imageUrl: 'https://cdn.example.com/mac.jpg',
  manageStock: true,
  name: 'Apple MacBook Air M2',
  price: 1_450_000,
  slug: 'apple-macbook-air-m2',
  stock: 3,
};

describe('ogabassey-catalog-agent-attributes', () => {
  it('enforces token boundaries on specs, exact policy terms, conditions, and promos', () => {
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 includes a 1080p webcam and 4K display.',
        [baseProduct]
      )
    ).toBe(true);

    // Substring collision ("8GB" inside "128GB storage") and role swaps ("128GB storage" -> "128GB RAM") must be rejected
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 has 8 GB RAM.', [
        { ...baseProduct, description: '128GB storage model' },
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 has 128GB RAM.', [
        { ...baseProduct, description: '128GB storage model' },
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 has 128GB storage.',
        [{ ...baseProduct, description: '128GB storage model' }]
      )
    ).toBe(true);
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 has 256GB storage.',
        [{ ...baseProduct, description: '256GB internal memory' }]
      )
    ).toBe(true);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 has 256GB RAM.', [
        { ...baseProduct, description: '256GB internal memory' },
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 has 8GB RAM.', [
        { ...baseProduct, description: '8GB DDR4 RAM' },
      ])
    ).toBe(true);
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 has 8GB RAM and a 120Hz display.',
        [{ ...baseProduct, description: '120Hz display with 8GB RAM' }]
      )
    ).toBe(true);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 has 8GB storage.', [
        { ...baseProduct, description: '8GB RAM with SSD storage' },
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 has 8GB RAM.', [
        { ...baseProduct, description: '8GB RAM with SSD storage' },
      ])
    ).toBe(true);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 has 8GB storage.', [
        { ...baseProduct, description: 'RAM: 8GB and storage: 256GB' },
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 has 8GB RAM.', [
        { ...baseProduct, description: 'RAM: 8GB and storage: 256GB' },
      ])
    ).toBe(true);

    // Contradictory warranty durations must not pass via bare stem match
    const oneYearProduct: StorefrontAgentUiProduct = {
      ...baseProduct,
      description: 'Includes a one-year manufacturer warranty',
    };
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 comes with a 1-year warranty.',
        [oneYearProduct]
      )
    ).toBe(true);
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 has a 10-year warranty.',
        [oneYearProduct]
      )
    ).toBe(false);

    // Ungrounded promotions fail closed, while negated promos are allowed
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 is 20% off.', [
        baseProduct,
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 has no discount available.',
        [baseProduct]
      )
    ).toBe(true);

    // Condition claims require grounded condition data
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 is UK used.', [
        baseProduct,
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 is brand new.', [
        { ...baseProduct, condition: 'Brand New' },
      ])
    ).toBe(true);

    // Grouped spec claims must hold for EVERY explicitly bound product
    const dellXps: StorefrontAgentUiProduct = {
      ...baseProduct,
      brand: 'Dell',
      description: 'Dell XPS 13',
      id: 'dell-13',
      name: 'Dell XPS 13',
      slug: 'dell-xps-13',
    };
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2, Dell XPS 13 both have 16 GB RAM.',
        [{ ...baseProduct, description: '16 GB RAM MacBook' }, dellXps]
      )
    ).toBe(false);

    // Color claims fail closed when ungrounded and pass when present in corpus
    expect(
      hasGroundedSpecAndPolicyClaims('Apple MacBook Air M2 comes in purple.', [
        baseProduct,
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple MacBook Air M2 comes in midnight.',
        [{ ...baseProduct, description: 'Midnight finish' }]
      )
    ).toBe(true);

    const iphone256 = {
      ...baseProduct,
      category: 'Phones',
      description: 'RAM 8GB; OLED display',
      id: 'iphone-16-256',
      name: 'Apple iPhone 16 256GB',
      slug: 'apple-iphone-16-256gb',
    };
    expect(
      hasGroundedSpecAndPolicyClaims('Apple iPhone 16 256GB has 8GB RAM.', [
        iphone256,
      ])
    ).toBe(true);
    expect(
      hasGroundedSpecAndPolicyClaims(
        'Apple iPhone 16 256GB has 256GB storage.',
        [iphone256]
      )
    ).toBe(true);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple iPhone 16 256GB has 256GB RAM.', [
        iphone256,
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple iPhone 16 256GB has 8GB storage.', [
        iphone256,
      ])
    ).toBe(false);

    const iphone7_32gb = {
      ...baseProduct,
      category: 'Phones',
      description: 'RAM 2GB; LCD display',
      id: 'iphone-7-32',
      name: 'Apple iPhone 7 32GB',
      slug: 'apple-iphone-7-32gb',
    };
    expect(
      hasGroundedSpecAndPolicyClaims('Apple iPhone 7 32GB has 32GB storage.', [
        iphone7_32gb,
      ])
    ).toBe(true);
    expect(
      hasGroundedSpecAndPolicyClaims('Apple iPhone 7 32GB has 32GB RAM.', [
        iphone7_32gb,
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims('ROG Phone 16GB 512GB has 16GB storage.', [
        {
          ...iphone7_32gb,
          brand: 'Asus',
          description: 'AMOLED display',
          id: 'rog-16-512',
          name: 'ROG Phone 16GB 512GB',
          slug: 'rog-phone-16gb-512gb',
        },
      ])
    ).toBe(false);
    expect(
      hasGroundedSpecAndPolicyClaims('Laptop has 16GB RAM.', [
        {
          ...baseProduct,
          description: '64GB RAM 16GB VRAM',
          name: 'Laptop',
        },
      ])
    ).toBe(false);
  });
});
