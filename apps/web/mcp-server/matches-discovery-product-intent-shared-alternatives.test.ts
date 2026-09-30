import { describe, expect, it } from 'vitest';
import { matchesDiscoveryProductIntent } from './matches-discovery-product-intent';

describe('shared constraints in discovery alternatives', () => {
  it('carries a trailing brand and device type across color alternatives', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Red Samsung Galaxy A55', category: 'Smartphones' }, 'red or blue Samsung phone')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Blue Samsung Galaxy A55', category: 'Smartphones' }, 'red or blue Samsung phone')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Red Apple iPhone 15', category: 'Smartphones' }, 'red or blue Samsung phone')).toBe(false);
  });

  it('carries a trailing device family across accessory color alternatives', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Black iPhone Case', category: 'Accessories' }, 'black or white iPhone case')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'White iPhone Case', category: 'Accessories' }, 'black or white iPhone case')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Black Galaxy Case', category: 'Accessories' }, 'black or white iPhone case')).toBe(false);
  });

  it('keeps explicitly typed alternatives independent', () => {
    const query = 'laptop or black iPhone case';
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops' }, query)).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Black iPhone Case', category: 'Accessories' }, query)).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Black Galaxy Case', category: 'Accessories' }, query)).toBe(false);
  });

  it('keeps real brand alternatives independent and constrains one-word brand searches', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Samsung Galaxy A55', category: 'Smartphones' }, 'Samsung or Apple phone')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Apple iPhone 15', category: 'Smartphones' }, 'Samsung or Apple phone')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'HP Pavilion', brand: 'HP', category: 'Laptops' }, 'HP')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude', brand: 'Dell', category: 'Laptops' }, 'HP')).toBe(false);
  });
});
