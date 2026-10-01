import { describe, expect, it } from 'vitest';
import { buildCommercialGuideDescription } from './build-commercial-guide-description';

describe('buildCommercialGuideDescription', () => {
  it('prefers a trimmed excerpt', () => {
    expect(
      buildCommercialGuideDescription({
        excerpt: '  A useful guide. ',
        reading_time_minutes: 4,
      })
    ).toBe('A useful guide.');
  });

  it('falls back to reading time or a generic label', () => {
    expect(
      buildCommercialGuideDescription({
        excerpt: null,
        reading_time_minutes: 4,
      })
    ).toBe('4 minute guide');
    expect(
      buildCommercialGuideDescription({
        excerpt: null,
        reading_time_minutes: null,
      })
    ).toBe('Read the full guide');
  });
});
