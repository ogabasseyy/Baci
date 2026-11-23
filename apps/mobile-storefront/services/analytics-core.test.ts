import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockWarn = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
const mockCapture = jest.fn();
const mockCaptureException = jest.fn();
const mockRegister = jest.fn();
const mockScreen = jest.fn();
const mockIdentify = jest.fn();
const mockReset = jest.fn();
const mockFlush = jest.fn();
const mockShutdown = jest.fn();
const mockIsFeatureEnabled = jest.fn<() => Promise<boolean>>();
const mockGetFeatureFlag =
  jest.fn<() => Promise<string | boolean | undefined>>();
const mockReloadFeatureFlags = jest.fn();
let mockExpoConfigExtra: {
  posthogApiKey: string;
  posthogHost?: string;
  apiUrl?: string;
  merchantId?: string;
  merchantSlug?: string;
  merchantDomain?: string;
} = {
  posthogApiKey: 'ph_test',
  posthogHost: 'https://posthog.example.com',
  apiUrl: 'https://api.usebaci.com',
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  merchantDomain: 'ogabassey.com',
};

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    warn: mockWarn,
    info: mockInfo,
    error: mockError,
  }),
}));

jest.mock('expo-constants', () => ({
  expoConfig: {
    version: '2.3.4',
    get extra() {
      return mockExpoConfigExtra;
    },
  },
}));

jest.mock('posthog-react-native', () =>
  jest.fn().mockImplementation(() => ({
    capture: mockCapture,
    captureException: mockCaptureException,
    register: mockRegister,
    screen: mockScreen,
    identify: mockIdentify,
    reset: mockReset,
    flush: mockFlush,
    shutdown: mockShutdown,
    isFeatureEnabled: mockIsFeatureEnabled,
    getFeatureFlag: mockGetFeatureFlag,
    reloadFeatureFlags: mockReloadFeatureFlags,
  }))
);

describe('analytics core', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockExpoConfigExtra = {
      posthogApiKey: 'ph_test',
      posthogHost: 'https://posthog.example.com',
      apiUrl: 'https://api.usebaci.com',
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      merchantDomain: 'ogabassey.com',
    };
    jest.useFakeTimers().setSystemTime(new Date('2026-05-29T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initializes PostHog and tracks events with timestamps', async () => {
    const { initAnalytics, trackEvent, trackScreen } = await import(
      './analytics-core'
    );
    const PostHog = (await import('posthog-react-native')).default;

    await initAnalytics();
    trackEvent('Checkout Started', { subtotal: 2000 });
    trackScreen('Checkout');

    expect(PostHog).toHaveBeenCalledWith(
      'ph_test',
      expect.objectContaining({
        host: 'https://posthog.example.com',
        addTracingHeaders: [
          'usebaci.com',
          'www.usebaci.com',
          'api.usebaci.com',
          'ogabassey.com',
        ],
        before_send: expect.any(Function),
        customAppProperties: expect.any(Function),
        enableSessionReplay: false,
        sessionReplayConfig: expect.objectContaining({
          maskAllTextInputs: true,
          maskAllImages: true,
          maskAllSandboxedViews: true,
          captureLog: false,
          captureNetworkTelemetry: false,
        }),
      })
    );
    const [, options] = (PostHog as jest.Mock).mock.calls[0] as [
      string,
      { customAppProperties: (properties: Record<string, unknown>) => unknown },
    ];
    expect(
      options.customAppProperties({
        $app_version: '1.0.0',
        $app_build: '100',
      })
    ).toEqual({
      $app_version: '1.0.0',
      $app_build: '100',
      app_surface: 'mobile-storefront',
      release_version: '2.3.4',
      merchant_id: 'merchant-1',
      merchant_slug: 'ogabassey',
      merchant_domain: 'ogabassey.com',
    });
    expect(mockRegister).toHaveBeenCalledWith({
      app_surface: 'mobile-storefront',
      release_version: '2.3.4',
      merchant_id: 'merchant-1',
      merchant_slug: 'ogabassey',
      merchant_domain: 'ogabassey.com',
    });
    expect(mockCapture).toHaveBeenCalledWith('Checkout Started', {
      subtotal: 2000,
      timestamp: '2026-05-29T12:00:00.000Z',
    });
    expect(mockScreen).toHaveBeenCalledWith('Checkout', {
      timestamp: '2026-05-29T12:00:00.000Z',
    });
  });

  it('uses the EU PostHog host when app config omits a host override', async () => {
    mockExpoConfigExtra = { ...mockExpoConfigExtra, posthogHost: undefined };

    const { initAnalytics } = await import('./analytics-core');
    const PostHog = (await import('posthog-react-native')).default;

    await initAnalytics();

    expect(PostHog).toHaveBeenCalledWith(
      'ph_test',
      expect.objectContaining({ host: 'https://eu.i.posthog.com' })
    );
  });

  it('supports identity, feature flags, and shutdown', async () => {
    const {
      initAnalytics,
      getFeatureFlagValue,
      identifyUser,
      isFeatureEnabled,
      resetUser,
      setUserProperties,
      shutdownAnalytics,
    } = await import('./analytics-core');

    mockIsFeatureEnabled.mockResolvedValue(true);
    mockGetFeatureFlag.mockResolvedValue('variant-a');

    await initAnalytics();
    identifyUser('user-1', {
      email: 'buyer@example.com',
      name: 'Ada',
      loyaltyTier: 'buyer@example.com',
    });
    setUserProperties({
      phone: '+2348000000000',
      loyaltyPoints: 250,
      referrer: 'buyer@example.com',
    });
    resetUser();

    await expect(isFeatureEnabled('new-checkout')).resolves.toBe(true);
    await expect(getFeatureFlagValue('banner-copy')).resolves.toBe('variant-a');
    await shutdownAnalytics();

    expect(mockIdentify).toHaveBeenCalledWith('user-1', {
      name: 'Ada',
      $set_once: {
        first_seen: '2026-05-29T12:00:00.000Z',
      },
    });
    expect(mockCapture).toHaveBeenCalledWith('$set', {
      $set: { loyaltyPoints: 250 },
    });
    expect(mockReset).toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledTimes(2);
    expect(mockRegister).toHaveBeenNthCalledWith(2, {
      app_surface: 'mobile-storefront',
      release_version: '2.3.4',
      merchant_id: 'merchant-1',
      merchant_slug: 'ogabassey',
      merchant_domain: 'ogabassey.com',
    });
    expect(mockFlush).toHaveBeenCalled();
    expect(mockShutdown).toHaveBeenCalled();
  });

  it('does not enqueue empty person-property updates after filtering', async () => {
    const { initAnalytics, setUserProperties } = await import(
      './analytics-core'
    );

    await initAnalytics();
    mockCapture.mockClear();
    setUserProperties({ phone: '+2348000000000' });

    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('enables exception autocapture and forwards manual exceptions', async () => {
    const { initAnalytics, captureException } = await import(
      './analytics-core'
    );
    const PostHog = (await import('posthog-react-native')).default;

    await initAnalytics();
    const error = new Error('checkout failed');
    captureException(error, {
      merchantId: 'merchant-1',
      requestUrl: 'https://ogabassey.com/checkout?token=secret',
    });

    expect(PostHog).toHaveBeenCalledWith(
      'ph_test',
      expect.objectContaining({
        errorTracking: {
          autocapture: expect.objectContaining({
            uncaughtExceptions: true,
            unhandledRejections: true,
            nativeCrashes: true,
          }),
        },
      })
    );
    expect(mockCaptureException).toHaveBeenCalledWith(error, {
      merchantId: 'merchant-1',
      requestUrl: 'https://ogabassey.com/checkout',
    });
  });

  it('redacts sensitive properties before PostHog enqueues events', async () => {
    const { initAnalytics } = await import('./analytics-core');
    const PostHog = (await import('posthog-react-native')).default;

    await initAnalytics();

    const [, options] = (PostHog as jest.Mock).mock.calls[0] as [
      string,
      {
        before_send: (event: {
          event: string;
          properties?: Record<string, unknown>;
          $set?: Record<string, unknown>;
        }) => unknown;
      },
    ];

    expect(
      options.before_send({
        event: 'Checkout Failed',
        properties: {
          email: 'buyer@example.com',
          note: 'Contact buyer@example.com',
          currentUrl:
            'https://ogabassey.com/cart/buyer@example.com?token=secret',
          nested: {
            phone: '+2348000000000',
          },
        },
        $set: {
          address: '12 Checkout Street',
        },
      })
    ).toMatchObject({
      properties: {
        email: '[Filtered]',
        note: 'Contact [Filtered]',
        currentUrl: 'https://ogabassey.com/cart/[Filtered]',
        nested: {
          phone: '[Filtered]',
        },
      },
      $set: {
        address: '[Filtered]',
      },
    });
  });

  it('captureException is a no-op before initialization', async () => {
    jest.resetModules();
    const { captureException } = await import('./analytics-core');

    expect(() => captureException(new Error('too early'))).not.toThrow();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
