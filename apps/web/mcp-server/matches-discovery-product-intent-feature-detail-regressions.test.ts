import { describe, expect, it } from 'vitest';
import { matchesDiscoveryProductIntent } from './matches-discovery-product-intent';

describe('discovery product intent feature and detail regressions', () => {
  it('requires requested feature modifiers while retaining item and brand constraints', () => {
    const earbuds = {
      name: 'Samsung Galaxy Buds', category: 'Earbuds',
      description: 'Wireless earbuds with noise cancelling.',
    };
    expect(matchesDiscoveryProductIntent(earbuds, 'noise cancelling earbuds')).toBe(true);
    expect(matchesDiscoveryProductIntent({ ...earbuds, description: 'Wireless earbuds.' }, 'noise cancelling earbuds')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: earbuds.description }, 'noise cancelling earbuds')).toBe(false);
    expect(matchesDiscoveryProductIntent(earbuds, 'Bose noise cancelling earbuds')).toBe(false);
  });

  it('accepts either complete RAM branch and rejects other or incomplete specifications', () => {
    const laptop16 = { name: 'Dell Laptop', category: 'Laptops', description: '16GB RAM.' };
    const laptop32 = { name: 'Dell Laptop', category: 'Laptops', description: '32GB RAM.' };
    const laptopStorage = { name: 'Dell Laptop', category: 'Laptops', description: '32GB storage.' };
    expect(matchesDiscoveryProductIntent(laptop16, 'laptop with 16GB or 32GB RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent(laptop32, 'laptop with 16GB or 32GB RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent(laptopStorage, 'laptop with 16GB or 32GB RAM')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '16GB SSD.' }, 'laptop with 16GB SSD or 32GB RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '32GB RAM.' }, 'laptop with 16GB SSD or 32GB RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '16GB RAM.' }, 'laptop with 16GB SSD or 32GB RAM')).toBe(false);
  });

  it('treats "at least" as a spec marker and retains the requested capacity context', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '16GB RAM.' }, 'laptop with at least 16GB RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '16GB storage.' }, 'laptop with at least 16GB RAM')).toBe(false);
  });

  it('treats by/from as identity markers for untyped device searches', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Apple iPhone 15', category: 'Smartphones' }, 'iPhone by Apple')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Google Pixel 9', category: 'Smartphones' }, 'Pixel from Google')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Google Pixel 9', category: 'Smartphones' }, 'iPhone by Apple')).toBe(false);
  });

  it('preserves in-ear as a compound modifier for headphones and earbuds', () => {
    expect(matchesDiscoveryProductIntent({ name: 'In-Ear Headphones', category: 'Headphones' }, 'in-ear headphones')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Over-Ear Headphones', category: 'Headphones' }, 'in-ear headphones')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Galaxy Buds', category: 'Earbuds', description: 'In-ear wireless earbuds.' }, 'in-ear earbuds')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Galaxy Buds', category: 'Earbuds', description: 'Wireless earbuds.' }, 'in-ear earbuds')).toBe(false);
  });
});

it('evaluates each complete capacity alternative once', () => {
  const query = 'laptop with 16GB RAM or 32GB RAM or 64GB RAM';
  for (const capacity of [16, 32, 64]) {
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: `${capacity}GB RAM` }, query)).toBe(true);
  }
  expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '8GB RAM' }, query)).toBe(false);
});
