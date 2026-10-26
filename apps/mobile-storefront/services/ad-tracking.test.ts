jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'https://api.test',
        tiktokBusiness: {
          isConfigured: false,
        },
      },
    },
  },
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(),
  randomUUID: jest.fn(() => 'uuid-1234567890'),
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
  },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));

jest.mock('@/lib/tracking-transparency', () => ({
  getTrackingPermissionStatus: jest
    .fn()
    .mockResolvedValue({ status: 'granted' }),
  requestTrackingPermissionStatus: jest
    .fn()
    .mockResolvedValue({ status: 'denied' }),
}));

jest.mock('./ad-tracking-native-modules', () => ({
  loadAdTrackingNativeModules: jest.fn().mockResolvedValue({
    AEMReporterIOS: null,
    AppEventsLogger: null,
    FBSettings: null,
    TikTokBusiness: null,
  }),
}));

jest.mock('./analytics', () => ({
  identifyUser: jest.fn(),
  resetUser: jest.fn(),
  trackAddToCart: jest.fn(),
  trackEvent: jest.fn(),
  trackOrderCompleted: jest.fn(),
  trackProductViewed: jest.fn(),
  trackSearch: jest.fn(),
}));

import {
  initAdTracking,
  trackAddToWishlist,
  trackPaymentInfoAdded,
  trackSearch,
} from './ad-tracking';

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function lastRequestBody() {
  const fetchMock = global.fetch as jest.Mock;
  const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return JSON.parse(String(init.body));
}

describe('ad-tracking server conversions', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ success: true }),
      text: jest.fn().mockResolvedValue(''),
    }) as jest.Mock;
    await initAdTracking();
  });

  it('records AddToWishlist internally without inferring purpose consent from ATT', async () => {
    await trackAddToWishlist({
      id: 'sku-1',
      name: 'iPhone 15',
      price: 120_000,
      currency: 'NGN',
    });
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/analytics/conversion',
      expect.any(Object)
    );
    expect(lastRequestBody()).toMatchObject({
      event_name: 'ADD_TO_WISHLIST',
      custom_data: {
        contents: [
          {
            id: 'sku-1',
            name: 'iPhone 15',
            price: 120_000,
            quantity: 1,
          },
        ],
        currency: 'NGN',
        value: 120_000,
      },
      analytics_consent: false,
      marketing_consent: false,
      targets: [],
    });
  });

  it('includes search_string for Search Events API payloads', async () => {
    await trackSearch('iphone', 12);
    await flushPromises();

    expect(lastRequestBody()).toMatchObject({
      event_name: 'SEARCH',
      custom_data: {
        search_string: 'iphone',
      },
    });
  });

  it('sends AddPaymentInfo to the server-side Events API path', async () => {
    await trackPaymentInfoAdded('card');
    await flushPromises();

    expect(lastRequestBody()).toMatchObject({
      event_name: 'ADD_PAYMENT_INFO',
      custom_data: {
        currency: 'NGN',
      },
    });
  });
});
