import { describe, expect, it } from 'vitest';
import { stripVolatileProductPriceSentences } from './storefront-product-description';

describe('stripVolatileProductPriceSentences', () => {
  it.each([
    '&nbsp;',
    '&#160;',
    '&#xA0;',
  ])('removes listed prices with encoded whitespace %s', (space) => {
    expect(
      stripVolatileProductPriceSentences(
        `Portable tablet. Current${space}listed price is NGN${space}100,000. Keep creating.`
      )
    ).toBe('Portable tablet. Keep creating.');
  });
  it('removes stale absolute listed-price sentences while preserving stable product copy', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Premium foldable phone. Current listed price is NGN 2,500,000. Confirm selected variant price before checkout.'
      )
    ).toBe(
      'Premium foldable phone. Confirm selected variant price before checkout.'
    );
  });

  it('handles naira-symbol listed-price sentences at the beginning of copy', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Current listed price is ₦5,800,000. Snapdragon flagship with a foldable display.'
      )
    ).toBe('Snapdragon flagship with a foldable display.');
  });
});

describe('stripVolatileProductPriceSentences edge cases', () => {
  it('returns an empty string for nullish and empty inputs', () => {
    expect(stripVolatileProductPriceSentences(null)).toBe('');
    expect(stripVolatileProductPriceSentences(undefined)).toBe('');
    expect(stripVolatileProductPriceSentences('')).toBe('');
  });

  it('removes decimal currency prices', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Specs ready. Current listed price is NGN 2,500.50. Confirm availability.'
      )
    ).toBe('Specs ready. Confirm availability.');
  });

  it('removes hyphenated NGN price ranges', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Specs ready. Current listed price is NGN 100 - 200. Confirm availability.'
      )
    ).toBe('Specs ready. Confirm availability.');
  });

  it('removes textual NGN price ranges', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Specs ready. Current listed price is NGN 100 to 200. Confirm availability.'
      )
    ).toBe('Specs ready. Confirm availability.');
  });

  it('removes en dash and em dash price ranges', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Specs ready. Current listed price is ₦100 – 200. Current listed price is ₦300 — 400. Confirm availability.'
      )
    ).toBe('Specs ready. Confirm availability.');
  });

  it('removes N-prefixed listed prices', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Specs ready. Current listed price is N 5000. Confirm availability.'
      )
    ).toBe('Specs ready. Confirm availability.');
  });

  it('removes HTML-wrapped listed-price text next to tag boundaries', () => {
    expect(
      stripVolatileProductPriceSentences(
        '<p>Current listed price is NGN 2,500,000.</p><p>Snapdragon flagship.</p>'
      )
    ).toBe('<p></p><p>Snapdragon flagship.</p>');
  });

  it('removes listed-price text when inline formatting tags split the amount', () => {
    expect(
      stripVolatileProductPriceSentences(
        '<p>Current listed price is <strong>NGN 2,500,000</strong>.</p><p>Snapdragon flagship.</p>'
      )
    ).toBe('<p></p><p>Snapdragon flagship.</p>');
  });

  it('removes inline listed-price fragments without removing surrounding product copy', () => {
    expect(
      stripVolatileProductPriceSentences(
        "This product's specs include current listed price is NGN 100 and other features."
      )
    ).toBe("This product's specs include and other features.");
  });

  it('removes listed prices with an optional leading the', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Specs ready. The current listed price is NGN 100. Confirm availability.'
      )
    ).toBe('Specs ready. Confirm availability.');
  });

  it('removes multiple consecutive listed-price sentences', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Specs ready. Current listed price is NGN 100. Current listed price is NGN 200. Confirm availability.'
      )
    ).toBe('Specs ready. Confirm availability.');
  });

  it('removes listed prices without trailing periods', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Current listed price is NGN 100 More text after the price.'
      )
    ).toBe('More text after the price.');
  });

  it('normalizes whitespace and space before punctuation after removal', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Description .   Current listed price is NGN 100.   More text.'
      )
    ).toBe('Description. More text.');
  });

  it('preserves intentional line breaks in plain-text descriptions', () => {
    expect(
      stripVolatileProductPriceSentences(
        'Line one.\nCurrent listed price is NGN 100.\nLine two with  extra spacing.'
      )
    ).toBe('Line one.\n\nLine two with extra spacing.');
  });
});
