import { describe, expect, it } from 'vitest';
import { getOgabasseyCategoryGuideCopy } from './blog-category-guide-copy';

describe('blog-category-guide-copy', () => {
  describe('getOgabasseyCategoryGuideCopy', () => {
    it.each([
      ['smartphones', 'How to use Ogabassey smartphone articles'],
      ['laptops', 'How to use Ogabassey laptop articles'],
      ['gaming', 'How to use Ogabassey gaming articles'],
      ['buying-guides', 'How to use Ogabassey buying guide articles'],
      ['deals', 'How to use Ogabassey deals articles'],
      ['news', 'How to use Ogabassey news articles'],
      [
        'platform-comparisons',
        'How to use Ogabassey platform comparison articles',
      ],
      ['accessories', 'How to use Ogabassey accessories articles'],
      ['tablets', 'How to use Ogabassey tablet articles'],
      ['wearables', 'How to use Ogabassey wearable articles'],
      ['repairs', 'How to use Ogabassey repair articles'],
      ['how-to-guides', 'How to use Ogabassey how-to guide articles'],
      ['tips-and-tricks', 'How to use Ogabassey tips and tricks articles'],
    ])('returns structured editorial copy for canonical category "%s"', (category, expectedHeading) => {
      const guide = getOgabasseyCategoryGuideCopy(category);
      expect(guide).not.toBeNull();
      expect(guide?.heading).toBe(expectedHeading);
      expect(guide?.paragraphs.length).toBeGreaterThan(0);
      expect(guide?.bullets.length).toBeGreaterThan(0);

      // Verify each item has id and text
      for (const item of [
        ...(guide?.paragraphs ?? []),
        ...(guide?.bullets ?? []),
      ]) {
        expect(item.id).toBeTruthy();
        expect(item.text).toBeTruthy();
      }
    });

    it.each([
      ['smartphone', 'How to use Ogabassey smartphone articles'],
      ['laptop', 'How to use Ogabassey laptop articles'],
      ['tablet', 'How to use Ogabassey tablet articles'],
      ['wearable', 'How to use Ogabassey wearable articles'],
      ['accessory', 'How to use Ogabassey accessories articles'],
      ['buying-guide', 'How to use Ogabassey buying guide articles'],
      ['technews', 'How to use Ogabassey tech news articles'],
      ['how-to', 'How to use Ogabassey how-to guide articles'],
      ['how-to-guide', 'How to use Ogabassey how-to guide articles'],
      ['tips', 'How to use Ogabassey tips and tricks articles'],
      ['tips-and-trick', 'How to use Ogabassey tips and tricks articles'],
      ['repair', 'How to use Ogabassey repair articles'],
      ['reviews', 'How to use Ogabassey review articles'],
    ])('resolves category alias "%s" to canonical copy', (alias, expectedHeading) => {
      const guide = getOgabasseyCategoryGuideCopy(alias);
      expect(guide).not.toBeNull();
      expect(guide?.heading).toBe(expectedHeading);
    });

    it('normalizes category labels with whitespace, punctuation, and casing', () => {
      const trimmed = getOgabasseyCategoryGuideCopy(
        '  Smartphone Comparisons  '
      );
      expect(trimmed).not.toBeNull();
      expect(trimmed?.heading).toBe(
        'How to use Ogabassey smartphone comparison articles'
      );

      const punctuated = getOgabasseyCategoryGuideCopy(
        'Smartphone Comparisons!!!'
      );
      expect(punctuated).not.toBeNull();
      expect(punctuated?.heading).toBe(
        'How to use Ogabassey smartphone comparison articles'
      );

      const mixedCase = getOgabasseyCategoryGuideCopy('SMARTPHONES');
      expect(mixedCase).not.toBeNull();
      expect(mixedCase?.heading).toBe(
        'How to use Ogabassey smartphone articles'
      );
    });

    it('returns null for unmapped or unknown categories', () => {
      expect(getOgabasseyCategoryGuideCopy('Solar Inverters')).toBeNull();
      expect(getOgabasseyCategoryGuideCopy('Fashion')).toBeNull();
      expect(getOgabasseyCategoryGuideCopy('Unknown')).toBeNull();
      expect(getOgabasseyCategoryGuideCopy('')).toBeNull();
    });
  });
});
