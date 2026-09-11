import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  generic: vi.fn(),
  initiateCheckout: vi.fn(),
  purchase: vi.fn(),
  viewContent: vi.fn(),
}));
vi.mock('@/lib/facebook-capi', () => ({
  facebookCAPI: {
    addToCart: mocks.addToCart,
    initiateCheckout: mocks.initiateCheckout,
    purchase: mocks.purchase,
    viewContent: mocks.viewContent,
  },
  sendFacebookCAPIEvent: mocks.generic,
}));

import { sendFacebookAdPlatformEvent } from './send-facebook-ad-platform-event';

describe('sendFacebookAdPlatformEvent', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    'product',
    'product_group',
  ] as const)('preserves %s registration metadata without inventing catalog IDs', async (contentType) => {
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
      custom_data: { content_type: contentType, content_name: 'Registration' },
      event_id: 'registration',
      event_type: 'customer_registered',
      merchant_id: 'merchant',
      source: 'server' as const,
      user_data: {},
    };
    await sendFacebookAdPlatformEvent(config, event, 'CompleteRegistration');
    expect(mocks.generic.mock.calls.at(-1)?.[4]).toEqual({
      contentType,
      currency: 'NGN',
      value: 0,
    });
    await sendFacebookAdPlatformEvent(
      config,
      {
        ...event,
        custom_data: {
          ...event.custom_data,
          contents: [
            { id: ' phone ', quantity: 1 },
            { id: '   ', quantity: 1 },
          ],
        },
      },
      'AddToWishlist'
    );
    expect(mocks.generic.mock.calls.at(-1)?.[4]).toMatchObject({
      contentType,
      contentIds: ['phone'],
    });
  });

  it('passes enhanced matching, LDU, and persisted occurrence time', async () => {
    mocks.purchase.mockResolvedValue({ success: true });
    await sendFacebookAdPlatformEvent(
      {
        facebook_capi_token: 'token',
        facebook_pixel_id: 'pixel',
        ga4_api_secret: null,
        google_analytics_id: null,
        offline_conversions_enabled: true,
        snapchat_capi_token: null,
        snapchat_pixel_id: null,
        tiktok_access_token: null,
        tiktok_pixel_id: null,
      },
      {
        custom_data: {
          contents: [{ id: 'sku-1', price: 100, quantity: 1 }],
          order_id: 'order-1',
          value: 100,
        },
        event_id: 'event-1',
        event_type: 'purchase',
        limited_data_use: true,
        merchant_id: 'merchant-1',
        occurred_at: '2026-07-12T12:00:00.000Z',
        source: 'server',
        user_data: { city: 'Lagos', email: 'buyer@example.com' },
      },
      'Purchase'
    );
    expect(mocks.purchase).toHaveBeenCalledWith(
      'pixel',
      'token',
      expect.objectContaining({ city: 'Lagos', email: 'buyer@example.com' }),
      'order-1',
      100,
      'NGN',
      expect.any(Array),
      undefined,
      'event-1',
      true,
      undefined,
      1_783_857_600
    );
  });

  it('fails closed without credentials', async () => {
    await expect(
      sendFacebookAdPlatformEvent(
        {
          facebook_capi_token: null,
          facebook_pixel_id: null,
          ga4_api_secret: null,
          google_analytics_id: null,
          offline_conversions_enabled: true,
          snapchat_capi_token: null,
          snapchat_pixel_id: null,
          tiktok_access_token: null,
          tiktok_pixel_id: null,
        },
        {
          custom_data: {},
          event_id: 'event-1',
          event_type: 'purchase',
          merchant_id: 'merchant-1',
          source: 'server',
          user_data: {},
        },
        'Purchase'
      )
    ).resolves.toEqual({ error: 'not_configured', success: false });
    expect(mocks.purchase).not.toHaveBeenCalled();
  });

  it('fails closed without purchase data', async () => {
    await expect(
      sendFacebookAdPlatformEvent(
        {
          facebook_capi_token: 'token',
          facebook_pixel_id: 'pixel',
          ga4_api_secret: null,
          google_analytics_id: null,
          offline_conversions_enabled: true,
          snapchat_capi_token: null,
          snapchat_pixel_id: null,
          tiktok_access_token: null,
          tiktok_pixel_id: null,
        },
        {
          custom_data: {},
          event_id: 'event-1',
          event_type: 'purchase',
          merchant_id: 'merchant-1',
          source: 'server',
          user_data: {},
        },
        'Purchase'
      )
    ).resolves.toEqual({ error: 'missing_purchase_data', success: false });
    expect(mocks.purchase).not.toHaveBeenCalled();
  });

  it('propagates limited data use through every Facebook dispatch branch', async () => {
    for (const mock of [
      mocks.addToCart,
      mocks.generic,
      mocks.initiateCheckout,
      mocks.purchase,
      mocks.viewContent,
    ]) {
      mock.mockResolvedValue({ success: true });
    }
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
    } as const;
    const event = (eventType: string) => ({
      custom_data: {
        contents: [{ id: 'sku-1', name: 'Product', quantity: 1 }],
        order_id: 'order-1',
        search_string: 'product',
        value: 100,
      },
      event_id: `event-${eventType}`,
      event_type: eventType,
      limited_data_use: true,
      merchant_id: 'merchant-1',
      source: 'server' as const,
      user_data: {},
    });

    await sendFacebookAdPlatformEvent(config, event('purchase'), 'Purchase');
    await sendFacebookAdPlatformEvent(
      config,
      event('begin_checkout'),
      'InitiateCheckout'
    );
    await sendFacebookAdPlatformEvent(config, event('cart'), 'AddToCart');
    await sendFacebookAdPlatformEvent(config, event('view'), 'ViewContent');
    await sendFacebookAdPlatformEvent(config, event('search'), 'Search');
    await sendFacebookAdPlatformEvent(
      config,
      event('payment'),
      'AddPaymentInfo'
    );

    expect(mocks.purchase.mock.calls.at(-1)?.[9]).toBe(true);
    expect(mocks.initiateCheckout.mock.calls.at(-1)?.[10]).toBe(true);
    expect(mocks.addToCart.mock.calls.at(-1)?.[11]).toBe(true);
    expect(mocks.viewContent.mock.calls.at(-1)?.[12]).toBe(true);
    expect(mocks.generic).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.anything(),
      'Search',
      expect.anything(),
      expect.anything(),
      undefined,
      'event-search',
      true,
      undefined,
      undefined
    );
    expect(mocks.generic).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      'AddPaymentInfo',
      expect.anything(),
      expect.anything(),
      undefined,
      'event-payment',
      true,
      undefined,
      undefined
    );
  });
});
