import { describe, expect, it } from 'vitest';
import { matchesDiscoveryProductIntent } from './matches-discovery-product-intent';

describe('discovery compatibility targets', () => {
  it('validates model-only compatibility targets', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Galaxy S24 Case', category: 'Accessories', description: 'Compatible with Samsung Galaxy S24' }, 'case for S24')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15 Case', category: 'Accessories' }, 'case for S24')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Galaxy A55 Case', category: 'Accessories' }, 'case for A55')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15 Case', category: 'Accessories' }, 'case for A55')).toBe(false);
  });

  it('tolerates family words inside compatibility targets', () => {
    expect(matchesDiscoveryProductIntent({ name: 'S24 Case', category: 'Accessories', description: 'Compatible with Samsung Galaxy S24' }, 'case for Samsung S24')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15 Case', category: 'Accessories', description: 'Compatible with iPhone 15' }, 'case for Samsung S24')).toBe(false);
  });

  it('preserves explicitly requested family words', () => {
    const product = { name: 'S24 Case', category: 'Accessories', description: 'Compatible with Samsung Galaxy S24' };
    expect(matchesDiscoveryProductIntent(product, 'case for Samsung Galaxy S24')).toBe(true);
    expect(matchesDiscoveryProductIntent(product, 'case for Samsung Galaxy A55')).toBe(false);
  });
});
