import { beforeEach, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('@/lib/facebook-capi', () => ({
  facebookCAPI: {},
  sendFacebookCAPIEvent: send,
}));

import { sendFacebookAdPlatformEvent } from './send-facebook-ad-platform-event';

const config = {
  facebook_capi_token: 'token',
  facebook_pixel_id: 'pixel',
  ga4_api_secret: null,
  google_analytics_id: null,
  offline_conversions_enabled: true,
  snapchat_capi_token: null,
  snapchat_pixel_id: null,
  tiktok_access_token: null,
  tiktok_pixel_id: null,
};
const event = {
  event_id: 'event',
  event_type: 'search',
  merchant_id: 'merchant',
  source: 'server' as const,
  user_data: {},
  custom_data: {
    search_string: 'phone',
    contents: [
      { id: '  ', name: 'Wrong', quantity: 1 },
      { id: ' phone ', quantity: 1 },
    ],
  },
};
beforeEach(() => send.mockReset());
it('normalizes Search IDs and omits whitespace-only IDs', async () => {
  await sendFacebookAdPlatformEvent(config, event, 'Search');
  expect(send.mock.calls[0][4].contentIds).toEqual(['phone']);
});
it.each([
  undefined,
  'Explicit',
])('uses a valid normalized catalog item as name fallback, preserving %s', async (name) => {
  await sendFacebookAdPlatformEvent(
    config,
    { ...event, custom_data: { ...event.custom_data, content_name: name } },
    'AddToWishlist'
  );
  expect(send.mock.calls[0][4]).toMatchObject({
    contentIds: ['phone'],
    contentName: name || 'phone',
  });
});
