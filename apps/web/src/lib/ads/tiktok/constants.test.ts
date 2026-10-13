import { describe, expect, it } from 'vitest';
import {
  TIKTOK_ADS_API_ROOT,
  TIKTOK_ADS_API_VERSION,
  TIKTOK_ADS_PROVIDER,
  TIKTOK_ADS_REQUIRED_SCOPES,
} from './constants';

describe('TikTok Ads constants', () => {
  it('pins the selected API version and required scopes', () => {
    expect(TIKTOK_ADS_PROVIDER).toBe('tiktok_ads');
    expect(TIKTOK_ADS_API_VERSION).toBe('v1.3');
    expect(TIKTOK_ADS_API_ROOT).toContain('/open_api/v1.3');
    expect(TIKTOK_ADS_REQUIRED_SCOPES).toEqual(['44', '100']);
  });
});
