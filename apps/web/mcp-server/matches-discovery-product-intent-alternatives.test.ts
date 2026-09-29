import { describe, expect, it } from 'vitest';
import { matchesDiscoveryProductIntent } from './matches-discovery-product-intent';

describe('independent discovery alternatives and leading compatibility', () => {
  it.each([
    ['iPhone 15 or iPhone 14', 'iPhone 15', true],
    ['iPhone 15 or iPhone 14', 'iPhone 14', true],
    ['iPhone 15 or iPhone 14', 'iPhone 13', false],
    ['Pixel 8 or Pixel 9', 'Google Pixel 8', true],
    ['Pixel 8 or Pixel 9', 'Google Pixel 9', true],
    ['Pixel 8 or Pixel 9', 'Google Pixel 7', false],
    ['Pixel 8 or 9', 'Google Pixel 9', true],
    ['Pixel 8 or 9', 'Samsung Galaxy S24', false],
    ['Pixel 8 or 9 or 10', 'Google Pixel 10', true],
    ['Pixel 8 or 9 or 10', 'Samsung Galaxy S24', false],
    ['iPhone 15 Pro or 14 Pro', 'iPhone 14 Pro', true],
    ['iPhone 15 Pro or 14 Pro', 'iPhone 14', false],
  ])('matches untyped alternative %s against %s', (query, name, expected) => {
    expect(matchesDiscoveryProductIntent({ name, category: 'Smartphones' }, query)).toBe(expected);
  });

  it.each([
    ['MacBook Pro or MacBook Air', 'MacBook Pro', 'Laptops', true],
    ['MacBook Pro or MacBook Air', 'MacBook Air', 'Laptops', true],
    ['iPhone 15 Pro case or iPhone 15 case', 'iPhone 15 Case', 'Accessories', true],
    ['iPhone 15 Pro case or iPhone 15 case', 'iPhone 15 Pro Case', 'Accessories', true],
    ['iPhone 15 Pro case or iPhone 15 Max case', 'iPhone 15 Max Case', 'Accessories', true],
    ['iPhone 15 Pro case or iPhone 15 Max case', 'iPhone 15 Case', 'Accessories', false],
  ])('keeps qualifiers local in %s for %s', (query, name, category, expected) => {
    expect(matchesDiscoveryProductIntent({ name, category }, query)).toBe(expected);
  });

  it.each([
    ['Android phone or Apple charger', 'Apple USB-C Charger', 'Accessories', true],
    ['Android phone or Apple charger', 'Apple iPhone 15', 'Smartphones', false],
    ['Android phone or Apple tablet', 'Apple iPad Air', 'Tablets', true],
    ['Android phone or Apple tablet', 'Samsung Galaxy S24', 'Smartphones', true],
  ])('scopes Android to its branch in %s', (query, name, category, expected) => {
    expect(matchesDiscoveryProductIntent({ name, category }, query)).toBe(expected);
  });

  it.each(['compatible with iPhone 15', 'fits iPhone 15', 'for iPhone 15', 'with iPhone 15'])(
    'validates leading compatibility in %s', (query) => {
      expect(matchesDiscoveryProductIntent({ name: 'Case for iPhone 15' }, query)).toBe(true);
      expect(matchesDiscoveryProductIntent({ name: 'Case for iPhone 14' }, query)).toBe(false);
      expect(matchesDiscoveryProductIntent({ name: 'Dell Laptop' }, query)).toBe(false);
    }
  );
});
