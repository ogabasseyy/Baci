import { describe, expect, it } from 'vitest';
import { matchesDiscoveryProductIntent } from './matches-discovery-product-intent';

describe('discovery intent branch grammar', () => {
  it('accepts either feature in a detail OR branch', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: 'Built-in Wi-Fi.' }, 'laptop with wifi or bluetooth')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: 'Bluetooth 5.3.' }, 'laptop with wifi or bluetooth')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop', category: 'Laptops', description: 'Ethernet only.' }, 'laptop with wifi or bluetooth')).toBe(false);
  });

  it('shares a leading brand across modifier alternatives without merging brand alternatives', () => {
    expect(matchesDiscoveryProductIntent({ name: 'Dell Red Latitude Laptop', brand: 'Dell', category: 'Laptops' }, 'Dell red or blue laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Blue Latitude Laptop', brand: 'Dell', category: 'Laptops' }, 'Dell red or blue laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'HP Blue Pavilion Laptop', brand: 'HP', category: 'Laptops' }, 'Dell red or blue laptop')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Dell Latitude Laptop', brand: 'Dell', category: 'Laptops' }, 'Dell or HP laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'HP Pavilion Laptop', brand: 'HP', category: 'Laptops' }, 'Dell or HP laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'ASUS Zenbook Laptop', brand: 'ASUS', category: 'Laptops' }, 'Dell or HP laptop')).toBe(false);
  });

  it('keeps USB-C distinct from USB-A and unspecified USB', () => {
    expect(matchesDiscoveryProductIntent({ name: 'USB-C Charger', category: 'Accessories' }, 'USB-C charger')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'USB C Charger', category: 'Accessories' }, 'USB-C charger')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'USBC Charger', category: 'Accessories' }, 'USB-C charger')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'USB-A Charger', category: 'Accessories' }, 'USB-C charger')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'USB Charger', category: 'Accessories' }, 'USB-C charger')).toBe(false);
  });
});
