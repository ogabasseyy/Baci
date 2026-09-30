import { describe, expect, it } from 'vitest';
import { matchesDiscoveryProductIntent } from './matches-discovery-product-intent';

describe('reviewed device and item modifiers', () => {
  it('retains generic phone compatibility targets', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Camera Case', category: 'Accessories' }, 'case for phone')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Phone Case', category: 'Accessories' }, 'case for phone')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Case for iPhone', category: 'Accessories' }, 'case for phones')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Laptop Case', category: 'Accessories' }, 'case for phone')).toBe(false);
  });
  it('checks qualifiers at each matching compatibility occurrence', () => {
    const product = { name: 'Protective Case', category: 'Accessories', description: 'Compatible with iPhone 15 Pro and iPhone 15' };
    expect(matchesDiscoveryProductIntent(product, 'case for iPhone 15')).toBe(true);
    expect(matchesDiscoveryProductIntent({ ...product, description: 'Compatible with iPhone 15 Pro' }, 'case for iPhone 15')).toBe(false);
  });
  it('preserves the hyphenated in-ear modifier', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Over-Ear Headphones', category: 'Headphones' }, 'in-ear headphones')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'In-Ear Headphones', category: 'Headphones' }, 'in-ear headphones')).toBe(true);
  });
  it('does not let a description override a conflicting catalog type', () => {
    expect(matchesDiscoveryProductIntent({ name: 'iPhone 15', category: 'Smartphones', description: '48MP camera for beautiful photos' }, 'camera')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Xiaomi C300', category: 'Cameras', description: 'Security camera for home' }, 'camera')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Vision 20S', category: 'Accessories', description: 'Compact power bank for phones' }, 'power bank')).toBe(true);
  });
});
