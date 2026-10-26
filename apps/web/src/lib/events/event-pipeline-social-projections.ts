/** Exact server-worker projections; browser settings never read secret columns. */
export const socialDeliveryProjections = {
  xDelivery: {
    merchants:
      'plan_tier plan_expires_at premium_features offline_conversions_enabled'.split(
        ' '
      ),
    merchant_feature_settings: ['twitter_pixel_id', 'twitter_event_ids'],
    merchant_x_ads_credentials: [
      'consumer_key',
      'consumer_secret',
      'access_token',
      'access_token_secret',
    ],
  },
  chatgptDelivery: {
    merchants:
      'slug plan_tier plan_expires_at premium_features offline_conversions_enabled'.split(
        ' '
      ),
    merchant_feature_settings: ['chatgpt_pixel_id'],
    merchant_chatgpt_ads_credentials: ['capi_key'],
    domains: ['domain'],
  },
};
