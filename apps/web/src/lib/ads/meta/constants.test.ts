import { describe, expect, it } from 'vitest';
import {
  META_ADS_CONVERSION_ACTION_PRIORITY,
  META_ADS_CONVERSION_ACTION_TYPES,
  META_ADS_GRAPH_VERSION,
  META_ADS_PROVIDER,
  META_ADS_SCOPE,
  META_ADS_STATE_COOKIE,
} from './constants';

describe('Meta Ads constants', () => {
  it('pins the provider contract and purchase action allowlist', () => {
    expect(META_ADS_PROVIDER).toBe('meta_ads');
    expect(META_ADS_GRAPH_VERSION).toBe('v25.0');
    expect(META_ADS_SCOPE).toBe('ads_read');
    expect(META_ADS_STATE_COOKIE).toBe('baci_meta_ads_oauth_state');
    expect([...META_ADS_CONVERSION_ACTION_TYPES]).toEqual([
      'offsite_conversion.fb_pixel_purchase',
      'omni_purchase',
      'purchase',
    ]);
    expect(META_ADS_CONVERSION_ACTION_PRIORITY).toEqual([
      'offsite_conversion.fb_pixel_purchase',
      'omni_purchase',
      'purchase',
    ]);
  });
});
