jest.mock('./ad-tracking-identity', () => ({
  posthogAddToCart: jest.fn(),
  posthogProductViewed: jest.fn(),
}));
jest.mock('./ad-tracking-runtime', () => ({
  generateEventIdSync: () => 'event',
  sendClientBackup: jest.fn(),
}));
jest.mock('./ad-tracking-server-conversion', () => ({
  sendServerConversion: jest.fn(),
}));
jest.mock('./tiktok-commerce-event-data', () => ({
  buildTikTokCommerceEventParams: () => ({}),
}));

import { trackAddToCart, trackProductViewed } from './ad-tracking-commerce';
import { sendClientBackup } from './ad-tracking-runtime';

describe('Facebook variant catalog matching', () => {
  it('uses product group IDs for product views and cart events', async () => {
    const product = { id: 'phone', name: 'Phone', price: 891000, quantity: 1 };
    await trackProductViewed(product);
    await trackAddToCart(product);
    expect(sendClientBackup).toHaveBeenCalledTimes(2);
    for (const call of jest.mocked(sendClientBackup).mock.calls) {
      expect(call[5]).toMatchObject({
        fb_content_id: 'phone',
        fb_content_type: 'product_group',
      });
    }
  });
});
