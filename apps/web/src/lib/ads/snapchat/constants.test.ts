import { describe, expect, it } from 'vitest';
import {
  SNAPCHAT_ADS_API_ROOT,
  SNAPCHAT_ADS_PROVIDER,
  SNAPCHAT_ADS_REQUIRED_SCOPES,
  SNAPCHAT_ADS_SCOPE,
  SNAPCHAT_ADS_STATE_COOKIE,
} from './constants';

describe('Snapchat Ads constants', () => {
  it('pins the v1 API and OAuth scope contract', () => {
    expect(SNAPCHAT_ADS_PROVIDER).toBe('snapchat_ads');
    expect(SNAPCHAT_ADS_API_ROOT).toBe('https://adsapi.snapchat.com/v1');
    expect(SNAPCHAT_ADS_SCOPE).toBe('snapchat-marketing-api');
    expect(SNAPCHAT_ADS_REQUIRED_SCOPES).toEqual([SNAPCHAT_ADS_SCOPE]);
    expect(SNAPCHAT_ADS_STATE_COOKIE).toBe('baci_snapchat_ads_oauth_state');
  });
});
