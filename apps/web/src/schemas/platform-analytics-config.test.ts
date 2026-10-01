import { describe, expect, it } from 'vitest';
import { platformAnalyticsConfigRowsSchema } from './platform-analytics-config';

const validConfig = {
  facebook_pixel_id: null,
  google_analytics_id: 'G-ABC123',
  snapchat_pixel_id: null,
  tiktok_pixel_id: null,
  twitter_pixel_id: null,
};

describe('platformAnalyticsConfigRowsSchema', () => {
  it('accepts the bounded public projection', () => {
    expect(platformAnalyticsConfigRowsSchema.parse([validConfig])).toEqual([
      validConfig,
    ]);
  });

  it('rejects unbounded or malformed RPC data', () => {
    expect(
      platformAnalyticsConfigRowsSchema.safeParse([validConfig, validConfig])
        .success
    ).toBe(false);
    expect(
      platformAnalyticsConfigRowsSchema.safeParse([
        { ...validConfig, google_analytics_id: '' },
      ]).success
    ).toBe(false);
  });
});
