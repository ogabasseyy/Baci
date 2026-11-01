import { describe, expect, it } from 'vitest';
import { generateMetaTitle } from './seo-utils';

describe('generateMetaTitle', () => {
  it('removes duplicated suffixes and keeps a single merchant suffix', () => {
    expect(
      generateMetaTitle('Buy Smartphones in Nigeria | Ogabassey | Ogabassey', {
        suffix: 'Ogabassey',
        maxLength: 70,
      })
    ).toBe('Buy Smartphones in Nigeria | Ogabassey');
  });

  it('adds suffix when missing and trims long titles', () => {
    const title = generateMetaTitle(
      "Introducing the iPhone 15 Series: Apple's Next Evolution in Smartphones",
      {
        suffix: 'Ogabassey',
        maxLength: 70,
      }
    );

    expect(title).toContain('Ogabassey');
    expect(title.length).toBeLessThanOrEqual(70);
  });

  it('keeps or drops a whitespace-padded suffix whole when truncating', () => {
    const longTitle =
      'Sony Alpha a7S III Mirrorless Camera Body Price in Nigeria';

    expect(
      generateMetaTitle(longTitle, { suffix: '  Ogabassey  ', maxLength: 60 })
    ).toBe('Sony Alpha a7S III Mirrorless Camera Body... | Ogabassey');
    expect(
      generateMetaTitle(longTitle, {
        suffix: '  Ogabassey  ',
        maxLength: 60,
        dropSuffixWhenTooLong: true,
      })
    ).toBe(longTitle);
  });

  it('deduplicates suffixes that include regex metacharacters', () => {
    expect(
      generateMetaTitle('Buy Smartphones | Oga(bassey)+? | Oga(bassey)+?', {
        suffix: 'Oga(bassey)+?',
        maxLength: 70,
      })
    ).toBe('Buy Smartphones | Oga(bassey)+?');
  });

  it('does not treat an inline substring as an existing suffix', () => {
    expect(
      generateMetaTitle('MacBook Pro 16', {
        suffix: 'Pro',
        maxLength: 70,
      })
    ).toBe('MacBook Pro 16 | Pro');
  });

  it('does not treat partial word matches as an existing suffix', () => {
    expect(
      generateMetaTitle('Restore your phone fast', {
        suffix: 'Store',
        maxLength: 70,
      })
    ).toBe('Restore your phone fast | Store');
  });
});
