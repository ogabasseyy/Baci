import { describe, expect, it } from 'vitest';
import { getProductSemanticSupport } from './product-semantic-support';

describe('getProductSemanticSupport', () => {
  it('inherits default trust support copy for supported categories', () => {
    expect(getProductSemanticSupport('smartphones')).toEqual({
      alternativesHeading: 'Alternative phones to compare',
      sameBrandHeading: 'More phones from this brand',
      samePriceHeading: 'More phones in this price range',
      trustBulletPrefix: 'Buying context',
    });
  });

  it('falls back to default copy for unsupported categories', () => {
    expect(getProductSemanticSupport('tablets')).toEqual({
      alternativesHeading: 'Similar options to consider',
      sameBrandHeading: 'More from this brand',
      samePriceHeading: 'More in this price range',
      trustBulletPrefix: 'Buying context',
    });
  });
});
