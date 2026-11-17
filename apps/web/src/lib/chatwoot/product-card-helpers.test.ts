import { describe, expect, it } from 'vitest';
import { isPurchasableProduct } from './product-card-is-purchasable-product';
import { isRecord } from './product-card-is-record';
import { toCardName } from './product-card-name';
import { normalizedCondition } from './product-card-normalized-condition';
import { numericStock } from './product-card-numeric-stock';
import { parentEffectiveStock } from './product-card-parent-effective-stock';
import { projectAttributes } from './product-card-project-attributes';
import { toImage } from './product-card-to-image';
import { toPrice } from './product-card-to-price';

describe('product card projection fields', () => {
  it('recognises plain records only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('accepts only finite non-negative numeric prices', () => {
    expect(toPrice(0)).toBe(0);
    expect(toPrice(10.5)).toBe(10.5);
    expect(toPrice(-1)).toBeNull();
    expect(toPrice(Number.NaN)).toBeNull();
    expect(toPrice(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toPrice('10')).toBeNull();
  });

  it('keeps only credential-free https images within the length limit', () => {
    expect(toImage('https://cdn.example.test/a.jpg')).toBe(
      'https://cdn.example.test/a.jpg'
    );
    expect(toImage({ url: 'https://cdn.example.test/b.jpg' })).toBe(
      'https://cdn.example.test/b.jpg'
    );
    expect(toImage('http://cdn.example.test/a.jpg')).toBeUndefined();
    expect(toImage('https://user:pw@cdn.example.test/a.jpg')).toBeUndefined();
    expect(toImage('not a url')).toBeUndefined();
    expect(toImage(`https://x.test/${'a'.repeat(2_100)}`)).toBeUndefined();
    expect(toImage(42)).toBeUndefined();
  });

  it('projects allow-listed option keys and rejects ambiguous ones', () => {
    expect(projectAttributes(null)).toEqual({});
    expect(projectAttributes('x')).toBeNull();
    expect(projectAttributes({ Color: ' Blue ', secret: 'x' })).toEqual({
      color: 'Blue',
    });
    expect(projectAttributes({ sim_type: 'dual' })).toEqual({
      'sim type': 'dual',
    });
    expect(projectAttributes({ color: 'a', colour: 'b' })).toEqual({
      color: 'a',
      colour: 'b',
    });
    expect(projectAttributes({ color: 'a', COLOR: 'c' })).toBeNull();
    expect(projectAttributes({ color: 'a', ' color ': 'b' })).toBeNull();
    expect(projectAttributes({ color: 3 })).toBeNull();
    expect(projectAttributes({ color: 'x'.repeat(81) })).toBeNull();
    expect(projectAttributes({ ['k'.repeat(41)]: 'x' })).toBeNull();
  });

  it('normalises only supported conditions', () => {
    expect(normalizedCondition('new')).toBe('new');
    expect(normalizedCondition('used')).toBe('used');
    expect(normalizedCondition(5)).toBeUndefined();
    expect(normalizedCondition('mystery')).toBeUndefined();
  });

  it('reads numeric stock from numbers and numeric strings', () => {
    expect(numericStock(3)).toBe(3);
    expect(numericStock('4')).toBe(4);
    expect(numericStock('abc')).toBeNull();
    expect(numericStock(undefined)).toBeNull();
  });

  it('prefers positive stock_quantity and falls back to legacy stock', () => {
    expect(parentEffectiveStock({ stock_quantity: 5, stock: 9 })).toBe(5);
    expect(parentEffectiveStock({ stock_quantity: 0, stock: 3.7 })).toBe(3);
    expect(parentEffectiveStock({ stock_quantity: -2 })).toBe(0);
    expect(parentEffectiveStock({})).toBe(0);
  });

  it('applies the inventory policy when judging purchasability', () => {
    expect(
      isPurchasableProduct({ effective_policy: 'serialized_then_unlimited' })
    ).toBe(true);
    expect(
      isPurchasableProduct({
        inventory_tracking_policy: 'serialized_strict',
        stock_quantity: 0,
      })
    ).toBe(false);
    expect(
      isPurchasableProduct({
        effective_policy: 'serialized_strict',
        stock_quantity: 2,
      })
    ).toBe(true);
    expect(isPurchasableProduct({ manage_stock: false })).toBe(true);
    expect(isPurchasableProduct({ stock_quantity: 0 })).toBe(false);
    expect(isPurchasableProduct({ stock_quantity: 1 })).toBe(true);
  });
});

describe('bugfix: card name keeps catalog-valid 200 character names', () => {
  it('truncates the display name to 120 characters instead of rejecting it', () => {
    expect(toCardName(`  ${'a'.repeat(200)}  `)).toBe('a'.repeat(120));
  });

  it('returns null for blank or non-string names', () => {
    expect(toCardName('   ')).toBeNull();
    expect(toCardName(7)).toBeNull();
  });
});
