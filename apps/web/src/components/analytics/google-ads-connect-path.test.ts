import { describe, expect, it } from 'vitest';
import { GOOGLE_ADS_CONNECT_PATH } from './google-ads-connect-path';

describe('Google Ads connect path', () => {
  it('uses the server OAuth route', () => {
    expect(GOOGLE_ADS_CONNECT_PATH).toBe(
      '/api/integrations/ads/google/connect'
    );
  });
});
