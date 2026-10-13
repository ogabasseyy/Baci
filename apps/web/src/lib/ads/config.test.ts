import { describe, expect, it } from 'vitest';
import {
  AdsConfigError,
  getCanonicalAdsCallbackUri,
  validateCanonicalAdsCallbackUri,
} from './config';

describe('ads callback configuration', () => {
  it('returns provider-specific canonical callbacks', () => {
    expect(getCanonicalAdsCallbackUri('snapchat_ads')).toBe(
      'https://usebaci.com/api/integrations/ads/snapchat/callback'
    );
  });

  it('rejects a callback that changes host, query, or provider path', () => {
    expect(() =>
      validateCanonicalAdsCallbackUri(
        'meta_ads',
        'https://evil.example/api/integrations/ads/meta/callback'
      )
    ).toThrow(AdsConfigError);
    expect(() =>
      validateCanonicalAdsCallbackUri(
        'meta_ads',
        'https://usebaci.com/api/integrations/ads/meta/callback?next=/x'
      )
    ).toThrow(AdsConfigError);
  });
});
