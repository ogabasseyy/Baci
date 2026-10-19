jest.mock('./ad-tracking-identity', () => ({
  posthogOrderCompleted: jest.fn(),
  posthogTrack: jest.fn(),
}));
jest.mock('./ad-tracking-runtime', () => ({
  generateEventId: async () => 'event',
  generateEventIdSync: () => 'event',
  trackAemEvent: jest.fn(),
  trackFacebookEvent: jest.fn(),
  trackFacebookPurchase: jest.fn(),
  trackTikTokEvent: jest.fn(),
}));
jest.mock('./ad-tracking-server-conversion', () => ({
  sendServerConversion: jest.fn(),
}));
jest.mock('./ad-tracking-state', () => ({
  adTrackingLog: { info: jest.fn() },
}));
jest.mock('./tiktok-commerce-event-data', () => ({
  buildTikTokCommerceEventParams: () => ({}),
}));

import { trackPurchase } from './ad-tracking-purchase';
import { trackFacebookPurchase } from './ad-tracking-runtime';

it('matches purchase contents to product groups without changing amounts', async () => {
  await trackPurchase({
    orderId: 'order',
    orderNumber: 'ORDER-1',
    subtotal: 891000,
    total: 891000,
    currency: 'NGN',
    items: [{ id: 'phone', name: 'Phone', price: 891000, quantity: 1 }],
  });
  expect(trackFacebookPurchase).toHaveBeenCalledWith(
    891000,
    'NGN',
    expect.objectContaining({
      fb_content_id: '["phone"]',
      fb_content_type: 'product_group',
    })
  );
});
