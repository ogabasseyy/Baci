import { expect, it } from 'vitest';
import { socialDeliveryProjections } from './event-pipeline-social-projections';

it('keeps provider credentials on their dedicated worker projections', () => {
  const { xDelivery, chatgptDelivery } = socialDeliveryProjections;
  expect(xDelivery.merchant_feature_settings).toEqual([
    'twitter_pixel_id',
    'twitter_event_ids',
  ]);
  expect(chatgptDelivery.merchant_feature_settings).toEqual([
    'chatgpt_pixel_id',
  ]);
  expect(xDelivery.merchant_x_ads_credentials).toEqual([
    'consumer_key',
    'consumer_secret',
    'access_token',
    'access_token_secret',
  ]);
  expect(chatgptDelivery.merchant_chatgpt_ads_credentials).toEqual([
    'capi_key',
  ]);
  for (const projection of [xDelivery, chatgptDelivery]) {
    expect(projection.merchants).toEqual(
      expect.arrayContaining([
        'plan_tier',
        'plan_expires_at',
        'premium_features',
        'offline_conversions_enabled',
      ])
    );
    expect(Object.values(projection).flat()).not.toContain('*');
  }
});
