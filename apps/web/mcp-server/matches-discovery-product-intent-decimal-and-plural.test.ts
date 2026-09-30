import { describe, expect, it } from 'vitest';
import { matchesDiscoveryProductIntent } from './matches-discovery-product-intent';
import { matchesWord } from './matches-discovery-product-intent-word-match';
import { words } from './matches-discovery-product-intent-words';

describe('discovery product intent decimal specifications and consonant-y plurals', () => {
  it('keeps decimal display sizes intact and requires the requested fraction', () => {
    expect(words('15.6-inch laptop')).toEqual(['15.6', 'inch', 'laptop']);
    expect(matchesDiscoveryProductIntent({ name: 'Dell 15.6-inch Laptop', category: 'Laptops' }, '15.6-inch laptop')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Dell 15-inch Laptop', category: 'Laptops' }, '15.6-inch laptop')).toBe(false);
    expect(matchesDiscoveryProductIntent({ name: 'Dell 15.6-inch Laptop', category: 'Laptops' }, '15-inch laptop')).toBe(false);
  });

  it('keeps decimal wireless specifications intact', () => {
    expect(words('2.4G mouse')).toEqual(['2.4g', 'mouse']);
    expect(matchesDiscoveryProductIntent({ name: 'Wireless 2.4G Mouse', category: 'Mice' }, '2.4G mouse')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Wireless 5G Mouse', category: 'Mice' }, '2.4G mouse')).toBe(false);
  });

  it('matches decimal specifications across compact and separated units', () => {
    const compact = { name: '1.5W Speaker', category: 'Speakers' };
    const separated = { name: '1.5 W Speaker', category: 'Speakers' };
    expect(matchesDiscoveryProductIntent(compact, 'speaker with 1.5 W')).toBe(true);
    expect(matchesDiscoveryProductIntent(separated, 'speaker with 1.5W')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: '1 W Speaker', category: 'Speakers' }, 'speaker with 1.5 W')).toBe(false);
  });

  it('matches accessory and accessories as singular and plural forms', () => {
    expect(matchesWord(['accessories'], 'accessory')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Protective Phone Case', category: 'Phone Accessories' }, 'phone accessory')).toBe(true);
    expect(matchesWord(['accessory'], 'accessories')).toBe(true);
    expect(matchesDiscoveryProductIntent({ name: 'Laptop Accessories', category: 'Accessories' }, 'laptop accessory')).toBe(true);
  });
});
