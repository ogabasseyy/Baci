import { describe, expect, it } from 'vitest';
import { matchesProductGuideIdentifier } from './matches-product-guide-identifier';

describe('matchesProductGuideIdentifier', () => {
  it('rejects an unbranded numeric identifier', () => {
    const result = matchesProductGuideIdentifier(
      {
        slug: 'smartphone-guide',
        title: 'Smartphone Buyer Guide',
        excerpt: null,
        category: 'Smartphones',
        tags: ['smartphones'],
        keywords: ['buyer guide'],
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['smartphone'],
      ['15'],
      false
    );

    expect(result).toBe(false);
  });
});
