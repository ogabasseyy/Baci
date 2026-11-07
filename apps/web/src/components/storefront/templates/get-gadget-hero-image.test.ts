import { describe, expect, it } from 'vitest';
import { getGadgetHeroImage } from './get-gadget-hero-image';

describe('getGadgetHeroImage', () => {
  it.each([
    ['ELECTRONICS', 'photo-1498049794561-7780e7231661'],
    ['FOOD_BEVERAGE', 'photo-1504674900247-0877df9cc836'],
    ['FASHION', 'photo-1441984904996-e0b6ba687e04'],
    ['HOME_GOODS', 'photo-1513584684374-8bdb74838a0f'],
    ['HEALTH_BEAUTY', 'photo-1522335789203-aabd1fc54bc9'],
    ['HAIR_EXTENSIONS', 'photo-1522337621169-d6cf09e65d95'],
    [null, 'photo-1498049794561-7780e7231661'],
    [undefined, 'photo-1498049794561-7780e7231661'],
    ['UNKNOWN', 'photo-1498049794561-7780e7231661'],
  ])('returns expected image URL for %s', (businessType, expectedSnippet) => {
    expect(getGadgetHeroImage(businessType)).toContain(expectedSnippet);
  });
});
