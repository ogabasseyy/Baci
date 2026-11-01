import { describe, expect, it } from 'vitest';
import { truncateMetaTitle } from './truncate-meta-title';

describe('truncateMetaTitle', () => {
  it('truncates at a word boundary without a suffix when none is given', () => {
    expect(
      truncateMetaTitle(
        'Sony Alpha a7S III Mirrorless Camera Body Price in Nigeria with Warranty',
        undefined,
        60
      )
    ).toBe('Sony Alpha a7S III Mirrorless Camera Body Price in...');
  });

  it('returns titles that already fit unchanged', () => {
    expect(
      truncateMetaTitle(
        'HP 15-fd0131 Price in Nigeria | Ogabassey',
        'Ogabassey',
        60
      )
    ).toBe('HP 15-fd0131 Price in Nigeria | Ogabassey');
  });

  it('drops the brand suffix instead of cutting "Price" mid-word when the product title then fits', () => {
    expect(
      truncateMetaTitle(
        'Sony Alpha a7S III Mirrorless Camera Body Price in Nigeria | Ogabassey',
        'Ogabassey',
        60,
        { dropSuffixWhenTooLong: true }
      )
    ).toBe('Sony Alpha a7S III Mirrorless Camera Body Price in Nigeria');
  });

  it('keeps the brand suffix by default and truncates the base at a word boundary', () => {
    expect(
      truncateMetaTitle(
        'Sony Alpha a7S III Mirrorless Camera Body Price in Nigeria | Ogabassey',
        'Ogabassey',
        60
      )
    ).toBe('Sony Alpha a7S III Mirrorless Camera Body... | Ogabassey');
  });

  it('truncates at a word boundary and keeps the suffix when even the bare title is too long', () => {
    const title = truncateMetaTitle(
      'Apple MacBook Pro 16-inch M4 Max 48GB 1TB Space Black Laptop Price in Nigeria | Ogabassey',
      'Ogabassey',
      60
    );

    expect(title).toBe(
      'Apple MacBook Pro 16-inch M4 Max 48GB 1TB... | Ogabassey'
    );
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it('strips a dangling separator before the ellipsis', () => {
    expect(
      truncateMetaTitle('Gaming Laptops - Deals - Best Prices Today', '', 30)
    ).toBe('Gaming Laptops - Deals...');
  });

  it('cuts a single overlong token mid-word rather than collapsing it', () => {
    const title = truncateMetaTitle(
      'A Supercalifragilisticexpialidocious',
      '',
      20
    );

    expect(title).toBe('A Supercalifragil...');
    expect(title.length).toBe(20);
  });

  it('truncates untitled-suffix titles at a word boundary without inventing a suffix', () => {
    expect(
      truncateMetaTitle(
        "Introducing the iPhone 15 Series: Apple's Next Evolution",
        '',
        40
      )
    ).toBe('Introducing the iPhone 15 Series...');
  });
});
