import { describe, expect, it } from 'vitest';
import {
  GOOGLE_ADS_OAUTH_COOKIE_MAX_AGE,
  GOOGLE_ADS_STATE_COOKIE,
  GOOGLE_ADS_VERIFIER_COOKIE,
} from './constants';

describe('Google Ads constants', () => {
  it('pins the OAuth cookie names and bounded lifetime', () => {
    expect(GOOGLE_ADS_STATE_COOKIE).toBe('baci_google_ads_oauth_state');
    expect(GOOGLE_ADS_VERIFIER_COOKIE).toBe('baci_google_ads_oauth_verifier');
    expect(GOOGLE_ADS_OAUTH_COOKIE_MAX_AGE).toBe(600);
  });
});
