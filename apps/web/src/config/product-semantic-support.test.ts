import { describe, expect, it } from 'vitest';
import { getProductSemanticSupport } from './product-semantic-support';

describe('getProductSemanticSupport', () => {
  it('returns category-specific headings and default trust copy for smartphones', () => {
    expect(getProductSemanticSupport('smartphones')).toEqual({
      alternativesHeading: 'Alternative phones to compare',
      sameBrandHeading: 'More phones from this brand',
      samePriceHeading: 'More phones in this price range',
      trustBulletPrefix: 'Buying context',
    });
  });

  it('returns category-specific headings for laptops', () => {
    expect(getProductSemanticSupport('laptops')).toEqual({
      alternativesHeading: 'Alternative laptops to compare',
      sameBrandHeading: 'More laptops from this brand',
      samePriceHeading: 'More laptops in this price range',
      trustBulletPrefix: 'Buying context',
    });
  });

  it('returns category-specific headings for tablets', () => {
    expect(getProductSemanticSupport('tablets')).toEqual({
      alternativesHeading: 'Alternative tablets to compare',
      sameBrandHeading: 'More tablets from this brand',
      samePriceHeading: 'More tablets in this price range',
      trustBulletPrefix: 'Buying context',
    });
  });

  it('returns category-specific headings for playstation-5', () => {
    expect(getProductSemanticSupport('playstation-5')).toEqual({
      alternativesHeading: 'Alternative PS5 consoles and games to compare',
      sameBrandHeading: 'More PlayStation 5 options from this brand',
      samePriceHeading: 'More PlayStation 5 options in this price range',
      trustBulletPrefix: 'Buying context',
    });
  });

  it('returns category-specific headings for smartwatches', () => {
    expect(getProductSemanticSupport('smartwatches')).toEqual({
      alternativesHeading: 'Alternative smartwatches to compare',
      sameBrandHeading: 'More smartwatches from this brand',
      samePriceHeading: 'More smartwatches in this price range',
      trustBulletPrefix: 'Buying context',
    });
  });

  it('returns category-specific headings for monitors', () => {
    expect(getProductSemanticSupport('monitors')).toEqual({
      alternativesHeading: 'Alternative monitors to compare',
      sameBrandHeading: 'More monitors from this brand',
      samePriceHeading: 'More monitors in this price range',
      trustBulletPrefix: 'Buying context',
    });
  });

  it('falls back to default copy for unknown categories and categories without custom headings', () => {
    const defaultCopy = {
      alternativesHeading: 'Similar options to consider',
      sameBrandHeading: 'More from this brand',
      samePriceHeading: 'More in this price range',
      trustBulletPrefix: 'Buying context',
    };

    expect(getProductSemanticSupport('unknown-category')).toEqual(defaultCopy);
    expect(getProductSemanticSupport('accessories')).toEqual(defaultCopy);
    expect(getProductSemanticSupport('')).toEqual(defaultCopy);
  });
});
