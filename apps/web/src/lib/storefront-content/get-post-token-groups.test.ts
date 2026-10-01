import { describe, expect, it } from 'vitest';
import { getPostTokenGroups } from './get-post-token-groups';

describe('getPostTokenGroups', () => {
  it('preserves post field order while using canonical tokenization', () => {
    const groups = getPostTokenGroups({
      title: 'Apple Watch 9+',
      excerpt: null,
      category: 'Smartwatches',
      tags: ['buyer guide'],
      keywords: ['£50'],
    });

    expect(groups).toEqual([
      ['apple', 'watch', '9', 'plus'],
      [],
      ['smartwatches'],
      ['buyer', 'guide'],
      ['gbp', '50'],
    ]);
  });

  it('normalizes slash and ampersand-separated post phrases into comparison boundaries', () => {
    const [titleTokens] = getPostTokenGroups({
      title: 'Apple iPhone 15 & Samsung Galaxy S25',
      excerpt: null,
      category: null,
      tags: null,
      keywords: null,
    });

    expect(titleTokens).toEqual([
      'apple',
      'iphone',
      '15',
      'versus',
      'samsung',
      'galaxy',
      's25',
    ]);
  });

  it('preserves ampersands inside a product model name', () => {
    const [titleTokens] = getPostTokenGroups({
      title: 'Ratchet & Clank: Rift Apart Buyer Guide',
      excerpt: null,
      category: 'Games',
      tags: null,
      keywords: null,
    });

    expect(titleTokens).toEqual([
      'ratchet',
      'clank',
      'rift',
      'apart',
      'buyer',
      'guide',
    ]);
  });

  it('normalizes an unspaced slash when the title has comparison evidence', () => {
    const [titleTokens] = getPostTokenGroups({
      title: 'Apple iPhone 15 128GB/Apple iPhone 15 256GB Comparison',
      excerpt: null,
      category: 'Smartphones',
      tags: null,
      keywords: null,
    });

    expect(titleTokens).toContain('versus');
  });

  it('normalizes text-only repeated model comparison separators', () => {
    const [titleTokens] = getPostTokenGroups({
      title:
        'Samsung Galaxy Buds Pro Black & Samsung Galaxy Buds Pro White Comparison',
      excerpt: null,
      category: 'Earbuds',
      tags: null,
      keywords: null,
    });

    expect(titleTokens).toContain('versus');
  });

  it('normalizes a single-letter Xbox Series shorthand comparison', () => {
    const [titleTokens] = getPostTokenGroups({
      title: 'Xbox Series X/S Comparison',
      excerpt: null,
      category: 'Xbox',
      tags: null,
      keywords: null,
    });

    expect(titleTokens).toEqual([
      'xbox',
      'series',
      'x',
      'versus',
      's',
      'comparison',
    ]);
  });

  it('normalizes an official pipe-separated Xbox Series shorthand comparison', () => {
    const [titleTokens] = getPostTokenGroups({
      title: 'Xbox Series X|S Comparison',
      excerpt: null,
      category: 'Xbox',
      tags: null,
      keywords: null,
    });

    expect(titleTokens).toEqual([
      'xbox',
      'series',
      'x',
      'versus',
      's',
      'comparison',
    ]);
  });

  it('normalizes a separator before a variant-only model tier', () => {
    const [titleTokens] = getPostTokenGroups({
      title: 'AirPods Pro/Max Comparison',
      excerpt: null,
      category: 'Earbuds',
      tags: null,
      keywords: null,
    });

    expect(titleTokens).toEqual([
      'airpods',
      'pro',
      'versus',
      'max',
      'comparison',
    ]);
  });

  it('normalizes a separator before a color-only continuation', () => {
    const [titleTokens] = getPostTokenGroups({
      title: 'Apple iPhone 15 Black & Blue Comparison',
      excerpt: null,
      category: 'Smartphones',
      tags: null,
      keywords: null,
    });

    expect(titleTokens).toContain('versus');
  });

  it('keeps an internal connectivity ampersand with its product segment', () => {
    const [titleTokens] = getPostTokenGroups({
      title: 'iPad 10 Wi-Fi & Cellular vs iPad 10 Wi-Fi',
      excerpt: null,
      category: 'Tablets',
      tags: null,
      keywords: null,
    });

    expect(titleTokens).toEqual([
      'ipad',
      '10',
      'wi',
      'fi',
      'versus',
      'cellular',
      'vs',
      'ipad',
      '10',
      'wi',
      'fi',
    ]);
  });
});
