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
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '32GB RAM.' }, 'laptop with at least 16GB RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '8GB RAM.' }, 'laptop with at least 16GB RAM')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '1TB RAM.' }, 'laptop with at least 16GB RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '16GB storage.' }, 'laptop with at least 16GB RAM')).toBe(false);
  });

  it('compares at-least power and refresh-rate specifications within their own units', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '30W charging.' }, 'laptop with at least 20W')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '15W charging.' }, 'laptop with at least 20W')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '144Hz display.' }, 'laptop with at least 120Hz')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '60Hz display.' }, 'laptop with at least 120Hz')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: '120Hz display.' }, 'laptop with at least 20W')).toBe(false);
  });

  it('treats additional handset makers as single-word identity constraints', () => {
    for (const [brand, productName] of [
      ['Motorola', 'Motorola Edge 50'],
      ['OnePlus', 'OnePlus 13'],
      ['Nothing', 'Nothing Phone 3'],
      ['Honor', 'Honor Magic 7'],
    ]) {
      expect(matchesDiscoveryProductIntent({ name: productName, category: 'Smartphones', brand }, brand)).toBe(true);
      expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy S25', category: 'Smartphones' }, brand)).toBe(false);
    }
  });

  it('matches numeric technology generations after detail boundaries', () => {
    const wifi6 = { name: 'Dell Laptop', category: 'Laptops', description: 'WiFi 6.' };
    const wifi5 = { name: 'Dell Laptop', category: 'Laptops', description: 'WiFi 5.' };
    const ddr5 = { name: 'Dell Laptop', category: 'Laptops', description: 'DDR5 RAM.' };
    const ddr4 = { name: 'Dell Laptop', category: 'Laptops', description: 'DDR4 RAM.' };

    expect(matchesDiscoveryProductIntent(wifi6, 'laptop with WiFi 6')).toBe(true);
    expect(matchesDiscoveryProductIntent(wifi5, 'laptop with WiFi 6')).toBe(false);
    expect(matchesDiscoveryProductIntent(ddr5, 'laptop with DDR5 RAM')).toBe(true);
    expect(matchesDiscoveryProductIntent(ddr4, 'laptop with DDR5 RAM')).toBe(false);
  });

  it('accepts a compatible base-model occurrence after a Pro model mention', () => {
    expect(matchesDiscoveryProductIntent({
      name: 'Screen Protector for iPhone 15 Pro and iPhone 15', category: 'Phone Accessories',
    }, 'iPhone 15 protector')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'Screen Protector for iPhone 15 Pro', category: 'Phone Accessories',
    }, 'iPhone 15 Pro protector')).toBe(true);
    expect(matchesDiscoveryProductIntent({
      name: 'Screen Protector for iPhone 15 Pro', category: 'Phone Accessories',
    }, 'iPhone 15 protector')).toBe(false);
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

it('checks lower-bound context without borrowing adjacent capacities', () => {
  const product = { name: 'Dell Laptop', category: 'Laptops', description: '16GB RAM, 512GB SSD' };
  expect(matchesDiscoveryProductIntent(product, 'laptop with at least 32GB RAM')).toBe(false);
  expect(matchesDiscoveryProductIntent({ ...product, description: '16GB SSD, 32GB RAM' }, 'laptop with at least 16GB RAM')).toBe(true);
});
