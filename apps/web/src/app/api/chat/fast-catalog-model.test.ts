import { describe, expect, it } from 'vitest';
import {
  catalogMatchesModel,
  catalogSearchQueries,
  catalogSymbolModelLookup,
} from './fast-catalog-model';

describe('catalog model matching', () => {
  it.each([
    'Samsung Galaxy S21+',
    'Samsung Galaxy S21 Plus',
  ])('requires Plus to describe the requested model: %s', (query) => {
    expect(
      catalogMatchesModel(query, 'Samsung Galaxy S21+ 5G', 'Samsung')
    ).toBe(true);
    expect(
      catalogMatchesModel(query, 'Samsung Galaxy S21 Plus 5G', 'Samsung')
    ).toBe(true);
    expect(catalogMatchesModel(query, 'Samsung Galaxy S21 5G', 'Samsung')).toBe(
      false
    );
    expect(
      catalogMatchesModel(
        query,
        'Samsung Galaxy S21 with Galaxy Buds Plus',
        'Samsung'
      )
    ).toBe(false);
    expect(
      catalogMatchesModel(
        query,
        'Samsung Galaxy S21 Plus USB-C Charger',
        'Samsung'
      )
    ).toBe(false);
  });

  it('searches both the word-form Plus and punctuation-normalized rankings', () => {
    expect(catalogSearchQueries('Samsung Galaxy S21+5G')).toEqual([
      'Samsung Galaxy S21 Plus 5G',
      'Samsung Galaxy S21 5G',
    ]);
    expect(catalogSearchQueries('Samsung Galaxy S21 Plus 5G')).toEqual([
      'Samsung Galaxy S21 Plus 5G',
      'Samsung Galaxy S21 5G',
    ]);
    expect(catalogSearchQueries('Samsung Galaxy S21')).toEqual([
      'Samsung Galaxy S21',
    ]);
    expect(catalogSearchQueries('Samsung Galaxy S21＋5G')).toEqual([
      'Samsung Galaxy S21 Plus 5G',
      'Samsung Galaxy S21 5G',
    ]);
  });

  it('fails closed when a numeric Plus marker is ambiguous', () => {
    expect(
      catalogMatchesModel(
        'Samsung Galaxy S21＋USB-C charger',
        'Samsung Galaxy S21 USB-C Charger Plus',
        'Samsung'
      )
    ).toBe(false);
  });

  it('binds Plus to a model that ends in a letter', () => {
    expect(
      catalogMatchesModel('iPhone 6s+', 'Apple iPhone 6s Plus', 'Apple')
    ).toBe(true);
    expect(
      catalogMatchesModel(
        'iPhone 6s+',
        'Apple iPhone 6s with Galaxy Buds Plus',
        'Apple'
      )
    ).toBe(false);
    expect(catalogSearchQueries('iPhone 6s+4G')).toEqual([
      'iPhone 6s Plus 4G',
      'iPhone 6s 4G',
    ]);
  });

  it('binds Pro Plus to its preceding model number', () => {
    const query = 'Tecno Spark 40 Pro+';
    expect(catalogMatchesModel(query, 'Tecno Spark 40 Pro+', 'Tecno')).toBe(
      true
    );
    expect(catalogMatchesModel(query, 'Tecno Spark 40 Pro Plus', 'Tecno')).toBe(
      true
    );
    expect(
      catalogMatchesModel(query, 'Tecno Spark 40 with Buds Pro Plus', 'Tecno')
    ).toBe(false);
    expect(catalogSearchQueries(query)).toEqual([
      'Tecno Spark 40 Pro Plus',
      'Tecno Spark 40 Pro',
    ]);
    expect(
      catalogMatchesModel(
        query,
        'Tecno Spark 41 Pro Plus with 40 accessories',
        'Tecno'
      )
    ).toBe(false);
    expect(
      catalogMatchesModel(
        'Tecno Spark 40 Pro+5G',
        'Tecno Spark 40 Pro Plus 5G',
        'Tecno'
      )
    ).toBe(true);
  });

  it('does not take a Plus model from a negated or secondary name clause', () => {
    const query = 'Tecno Spark 40 Pro+';
    expect(
      catalogMatchesModel(query, 'Tecno Spark 40 Pro (not 40 Pro+)', 'Tecno')
    ).toBe(false);
    expect(
      catalogMatchesModel(
        query,
        'Tecno Spark 40 Pro with a 40 Pro+ case',
        'Tecno'
      )
    ).toBe(false);
    expect(
      catalogMatchesModel(query, 'Tecno Spark 40 Pro+ with a charger', 'Tecno')
    ).toBe(true);
    expect(
      catalogMatchesModel(
        'Samsung S21+5G',
        'Samsung S21+ with Galaxy Buds 5G',
        'Samsung'
      )
    ).toBe(false);
  });

  it.each([
    'Tecno Spark 40 Pro （40 Pro+ case）',
    'Tecno Spark 40 Pro - case for 40 Pro+',
    'Tecno Spark 40 Pro and a 40 Pro+ case',
    'Tecno Spark 40 Pro & a 40 Pro+ case',
  ])('does not bind a model in a secondary clause: %s', (name) => {
    expect(catalogMatchesModel('Tecno Spark 40 Pro+', name, 'Tecno')).toBe(
      false
    );
  });

  it('accepts a parenthesized connectivity qualifier on the primary model', () => {
    expect(
      catalogMatchesModel(
        'Samsung Galaxy S21+5G',
        'Samsung Galaxy S21+ (5G)',
        'Samsung'
      )
    ).toBe(true);
  });

  it('does not bind a Plus model from a distant secondary clause', () => {
    expect(
      catalogMatchesModel(
        'Tecno Spark 40 Pro+',
        `Tecno Spark 40 Pro${' '.repeat(10_000)}not 40 Pro+`,
        'Tecno'
      )
    ).toBe(false);
  });

  it('binds hyphenated Plus to the model, not to an unrelated accessory', () => {
    expect(
      catalogMatchesModel('Samsung S21-Plus', 'Samsung S21 Plus', 'Samsung')
    ).toBe(true);
    expect(
      catalogMatchesModel(
        'Samsung S21-Plus',
        'Samsung S21 with Galaxy Buds Plus',
        'Samsung'
      )
    ).toBe(false);
    expect(catalogSearchQueries('Samsung S21-Plus')).toEqual([
      'Samsung S21 Plus',
      'Samsung S21',
    ]);
  });

  it('normalizes a nonbreaking hyphen before a Plus model', () => {
    expect(
      catalogMatchesModel('Samsung S21‑Plus', 'Samsung S21 Plus', 'Samsung')
    ).toBe(true);
    expect(
      catalogMatchesModel(
        'Samsung S21‑Plus',
        'Samsung S21 with Galaxy Buds Plus',
        'Samsung'
      )
    ).toBe(false);
    expect(catalogSearchQueries('Samsung S21‑Plus')).toEqual([
      'Samsung S21 Plus',
      'Samsung S21',
    ]);
    expect(catalogSymbolModelLookup('Samsung S21‑Plus')).toEqual({
      symbol: 'S21',
    });
  });

  it('does not match an unbound nonnumeric Plus marker', () => {
    expect(
      catalogMatchesModel(
        'Samsung Galaxy S+',
        'Samsung Galaxy S with Galaxy Buds Plus',
        'Samsung'
      )
    ).toBe(false);
  });

  it.each([
    'Samsung Galaxy Buds Plus',
    'Samsung Galaxy Buds Plus True Wireless Earbuds',
    'Samsung Galaxy Buds Plus True Wireless Stereo Earbuds',
  ])('accepts the exact word-form Plus product: %s', (name) => {
    expect(
      catalogMatchesModel('Samsung Galaxy Buds Plus', name, 'Samsung')
    ).toBe(true);
  });

  it.each([
    'Samsung Galaxy Buds Plus Replacement Charging Case',
    'Samsung Galaxy Buds Plus Replacement Left Earbud',
    'Samsung Galaxy Buds Plus Ear Tips',
    'Samsung Galaxy Buds Plus Left Earbud',
    'Samsung Galaxy Buds with Plus Charger',
    'Samsung Galaxy Buds 2 Plus',
  ])('does not substitute a different product for a word-form Plus request: %s', (name) => {
    expect(
      catalogMatchesModel('Samsung Galaxy Buds Plus', name, 'Samsung')
    ).toBe(false);
  });

  it('does not treat underscore-separated Plus as an unrelated model word', () => {
    expect(
      catalogMatchesModel(
        'Samsung Galaxy S21_Plus',
        'Samsung Galaxy S21 with Galaxy Buds Plus',
        'Samsung'
      )
    ).toBe(false);
  });

  it.each([
    '_',
    '/',
    '.',
    '—',
    '\u200b',
  ])('never binds unrelated Plus through the separator %s', (separator) => {
    expect(
      catalogMatchesModel(
        `Samsung Galaxy S21${separator}Plus`,
        'Samsung Galaxy S21 with Galaxy Buds Plus',
        'Samsung'
      )
    ).toBe(false);
  });

  it('fails closed for an unreasonably long Plus-model token', () => {
    const model = `${'9'.repeat(30_000)}+`;
    expect(
      catalogMatchesModel(`Samsung ${model}`, `Samsung ${model}`, 'Samsung')
    ).toBe(false);
  });

  it('does not extract an anchor from the end of an overlong model token', () => {
    const name = 'Tecno Spark ABCDEFGHIJKLMNOP9 Pro+';
    expect(catalogMatchesModel(name, name, 'Tecno')).toBe(false);
  });

  it('extracts only a bounded alphanumeric model for the literal symbol lookup', () => {
    expect(catalogSymbolModelLookup('Samsung Galaxy S21＋5G')).toEqual({
      symbol: 'S21',
    });
    expect(catalogSymbolModelLookup('iPhone 16 Plus')).toEqual({
      symbol: '16',
    });
    expect(catalogSymbolModelLookup('iPhone 7+')).toEqual({ symbol: '7' });
    expect(catalogSymbolModelLookup('iPhone 6s Plus')).toEqual({
      symbol: '6s',
    });
    expect(catalogSymbolModelLookup('Tecno Spark 40 Pro+')).toEqual({
      symbol: 'Pro',
      anchor: '40',
    });
    expect(catalogSymbolModelLookup('Samsung S21%+')).toBeNull();
    expect(catalogSymbolModelLookup(`Samsung ${'A'.repeat(20)}21+`)).toBeNull();
  });
});
