import { describe, expect, it } from 'vitest';
import { buildMerchantAnalyticsSettings } from './analytics-merchant-settings';

describe('buildMerchantAnalyticsSettings', () => {
  it('reads the new ChatGPT pixel only from entitled canonical feature settings', () => {
    expect(
      buildMerchantAnalyticsSettings({
        plan_tier: 'pro',
        plan_expires_at: null,
        feature_settings: { chatgpt_pixel_id: ' pixel-a ' },
        chatgpt_pixel_id: 'unpersisted-fallback',
      })
    ).toMatchObject({ chatgpt_pixel_id: 'pixel-a' });
    expect(
      buildMerchantAnalyticsSettings({
        plan_tier: 'pro',
        plan_expires_at: null,
        chatgpt_pixel_id: 'unpersisted-fallback',
      })
    ).toMatchObject({ chatgpt_pixel_id: null });
  });
  it('returns null for nullish merchant sources', () => {
    expect(buildMerchantAnalyticsSettings(null)).toBeNull();
    expect(buildMerchantAnalyticsSettings(undefined)).toBeNull();
  });

  it('returns null for primitive merchant sources', () => {
    expect(buildMerchantAnalyticsSettings('merchant')).toBeNull();
    expect(buildMerchantAnalyticsSettings(123)).toBeNull();
    expect(buildMerchantAnalyticsSettings(false)).toBeNull();
  });

  it('returns null for array merchant sources', () => {
    expect(buildMerchantAnalyticsSettings([])).toBeNull();
  });

  it('prefers normalized feature settings over legacy analytics fields', () => {
    expect(
      buildMerchantAnalyticsSettings({
        feature_settings: {
          google_analytics_id: ' G-FEATURE ',
        },
        google_analytics_id: 'G-LEGACY',
        plan_expires_at: null,
        plan_tier: 'pro',
      })
    ).toEqual(
      expect.objectContaining({
        google_analytics_id: 'G-FEATURE',
      })
    );
  });

  it('falls back to normalized legacy analytics fields when feature settings are blank', () => {
    expect(
      buildMerchantAnalyticsSettings({
        feature_settings: {
          google_analytics_id: '   ',
        },
        google_analytics_id: ' G-LEGACY ',
        plan_expires_at: null,
        plan_tier: 'pro',
      })
    ).toEqual(
      expect.objectContaining({
        google_analytics_id: 'G-LEGACY',
      })
    );
  });

  it('normalizes numeric IDs and drops unsupported values', () => {
    expect(
      buildMerchantAnalyticsSettings({
        facebook_pixel_id: 12345,
        plan_expires_at: null,
        plan_tier: 'pro',
        tiktok_pixel_id: false,
        twitter_pixel_id: {},
      })
    ).toEqual(
      expect.objectContaining({
        facebook_pixel_id: '12345',
        tiktok_pixel_id: null,
        twitter_pixel_id: null,
      })
    );
  });

  it('strips storefront pixel IDs for merchants without growth integrations', () => {
    expect(
      buildMerchantAnalyticsSettings({
        feature_settings: {
          google_analytics_id: 'G-FREE',
        },
        facebook_pixel_id: '12345',
        plan_tier: 'free',
        premium_features: [],
      })
    ).toEqual({
      chatgpt_pixel_id: null,
      google_analytics_id: null,
      facebook_pixel_id: null,
      tiktok_pixel_id: null,
      snapchat_pixel_id: null,
      twitter_pixel_id: null,
    });
  });

  it('honors explicit growth integration grants for storefront pixels', () => {
    expect(
      buildMerchantAnalyticsSettings({
        feature_settings: {
          google_analytics_id: ' G-GRANTED ',
        },
        plan_tier: 'free',
        premium_features: ['growth_integrations'],
      })
    ).toEqual(
      expect.objectContaining({
        google_analytics_id: 'G-GRANTED',
      })
    );
  });

  it('fails closed for paid plan data missing expiry information', () => {
    expect(
      buildMerchantAnalyticsSettings({
        feature_settings: {
          google_analytics_id: 'G-OMITTED-EXPIRY',
        },
        plan_tier: 'pro',
        premium_features: [],
      })
    ).toEqual({
      chatgpt_pixel_id: null,
      google_analytics_id: null,
      facebook_pixel_id: null,
      tiktok_pixel_id: null,
      snapchat_pixel_id: null,
      twitter_pixel_id: null,
    });
  });
});
