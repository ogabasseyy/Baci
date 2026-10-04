import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockRpc =
  jest.fn<
    (...args: unknown[]) => Promise<{ error: null | { message: string } }>
  >();
const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};
let mockPlatformOS: 'android' | 'ios' = 'ios';
let mockApplicationId = 'com.ogabassey.staging';
let mockTelemetryExcluded = false;
let mockExpoConfig: Record<string, unknown> = {
  extra: { eas: { projectId: 'project-id' } },
};
const mockCallOrder: string[] = [];
const mockSetNotificationChannelAsync = jest.fn(async (channelId: string) => {
  mockCallOrder.push(`setNotificationChannelAsync:${channelId}`);
});

jest.mock('@baci/shared/lib', () => ({
  getStorefrontNotificationNavigationTarget: jest.fn(),
}));

jest.mock('expo-application', () => ({
  get applicationId() {
    return mockApplicationId;
  },
  nativeBuildVersion: '646',
}));

jest.mock('expo-constants', () => ({
  get expoConfig() {
    return mockExpoConfig;
  },
}));

jest.mock('expo-device', () => ({
  isDevice: true,
  modelName: 'iPhone',
}));

jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: jest.fn(async () => {
    mockCallOrder.push('getExpoPushTokenAsync');
    return { data: 'ExponentPushToken[fresh]' };
  }),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(async (request: unknown) => {
    mockCallOrder.push('scheduleNotificationAsync');
    return `notification:${JSON.stringify(request)}`;
  }),
  setNotificationChannelAsync: mockSetNotificationChannelAsync,
  setNotificationHandler: jest.fn(),
  AndroidImportance: { DEFAULT: 'default', HIGH: 'high' },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => mockLogger,
}));

jest.mock('@/lib/storefront-telemetry-excluded', () => ({
  isStorefrontTelemetryExcluded: () => mockTelemetryExcluded,
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: mockRpc },
}));

const {
  handleNotificationResponse,
  registerForPushNotifications,
  resolveNativeBuildNumber,
  savePushTokenToServer,
} = require('./push-notifications') as typeof import('./push-notifications');
const { getStorefrontNotificationNavigationTarget } = jest.requireMock(
  '@baci/shared/lib'
) as {
  getStorefrontNotificationNavigationTarget: jest.Mock;
};

describe('savePushTokenToServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallOrder.length = 0;
    mockPlatformOS = 'ios';
    mockApplicationId = 'com.ogabassey.staging';
    mockRpc.mockResolvedValue({ error: null });
  });

  it('trims the token and merchant id and registers via the RPC', async () => {
    const saved = await savePushTokenToServer(
      '  ExponentPushToken[fresh]  ',
      '  user-1  ',
      '  merchant-1  '
    );

    expect(saved).toBe(true);
    // user_id is intentionally not sent: the SECURITY DEFINER RPC pins it to
    // auth.uid() server-side, so the client cannot register for another user.
    expect(mockRpc).toHaveBeenCalledWith(
      'register_push_token',
      expect.objectContaining({
        p_token: 'ExponentPushToken[fresh]',
        p_merchant_id: 'merchant-1',
        p_platform: 'ios',
        p_app_type: 'storefront',
        // Captured from Application.nativeBuildVersion ('646') for update-nudge
        // targeting.
        p_build_number: 646,
        p_shipment_update_capability: 1,
      })
    );
  });

  it('returns false when the RPC reports an error', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'rls denied' } });

    const saved = await savePushTokenToServer(
      'ExponentPushToken[fresh]',
      'user-1',
      'merchant-1'
    );

    expect(saved).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to save push token:',
      { message: 'rls denied' }
    );
  });

  it.each([
    ['token', '', 'user-1', 'merchant-1'],
    ['user id', 'ExponentPushToken[fresh]', '   ', 'merchant-1'],
    ['merchant id', 'ExponentPushToken[fresh]', 'user-1', '\n\t'],
  ])('returns false and skips the RPC when %s is blank', async (_field, token, userId, merchantId) => {
    const saved = await savePushTokenToServer(token, userId, merchantId);

    expect(saved).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Refusing to save push token: empty token/userId/merchantId'
    );
  });
});

describe('resolveNativeBuildNumber', () => {
  it('parses a numeric build string to an integer', () => {
    expect(resolveNativeBuildNumber('646')).toBe(646);
    expect(resolveNativeBuildNumber('  390  ')).toBe(390);
  });

  it('returns null for missing or malformed values', () => {
    expect(resolveNativeBuildNumber(null)).toBeNull();
    expect(resolveNativeBuildNumber('')).toBeNull();
    expect(resolveNativeBuildNumber('   ')).toBeNull();
    expect(resolveNativeBuildNumber('not-a-number')).toBeNull();
  });

  it('rejects partially numeric builds instead of truncating them', () => {
    // Strict Number(...) parse, matching the server gate — not parseInt, which
    // would read these as 646 and disagree with the release policy.
    expect(resolveNativeBuildNumber('646-beta')).toBeNull();
    expect(resolveNativeBuildNumber('646.1')).toBeNull();
  });

  it('defaults to the installed Application.nativeBuildVersion', () => {
    expect(resolveNativeBuildNumber()).toBe(646);
  });
});

describe('handleNotificationResponse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallOrder.length = 0;
    mockPlatformOS = 'ios';
    mockApplicationId = 'com.ogabassey.staging';
    mockTelemetryExcluded = false;
    mockExpoConfig = { extra: { eas: { projectId: 'project-id' } } };
  });

  it('navigates token-ready notifications to utility history', () => {
    const navigate =
      jest.fn<Parameters<typeof handleNotificationResponse>[1]>();
    const data = {
      type: 'vtu_token_ready',
      utilityType: 'power',
    };
    getStorefrontNotificationNavigationTarget.mockReturnValue({
      screen: 'utility-history',
      params: { type: 'power' },
    });

    handleNotificationResponse(
      {
        notification: {
          request: {
            content: {
              data,
            },
          },
        },
      } as unknown as Parameters<typeof handleNotificationResponse>[0],
      navigate
    );

    expect(navigate).toHaveBeenCalledWith('utility-history', {
      type: 'power',
    });
    expect(getStorefrontNotificationNavigationTarget).toHaveBeenCalledWith(
      data
    );
  });

  it('opens a validated savings push in the savings wallet panel before shared payload routing', () => {
    const navigate =
      jest.fn<Parameters<typeof handleNotificationResponse>[1]>();
    const data = {
      goalId: '00000000-0000-4000-8000-000000000002',
      merchantId: '00000000-0000-4000-8000-000000000010',
      notificationId: '00000000-0000-4000-8000-000000000001',
      type: 'savings',
    };

    handleNotificationResponse(
      {
        notification: {
          request: {
            content: { data },
          },
        },
      } as unknown as Parameters<typeof handleNotificationResponse>[0],
      navigate,
      undefined,
      '00000000-0000-4000-8000-000000000010'
    );

    expect(navigate).toHaveBeenCalledWith('wallet', { action: 'savings' });
    expect(getStorefrontNotificationNavigationTarget).not.toHaveBeenCalled();
  });

  it('invalidates the scoped wallet only for a validated same-merchant savings push', async () => {
    const navigate =
      jest.fn<Parameters<typeof handleNotificationResponse>[1]>();
    const invalidateSavingsWallet = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue();
    const response = {
      notification: {
        request: {
          content: {
            data: {
              goalId: '00000000-0000-4000-8000-000000000002',
              merchantId: '00000000-0000-4000-8000-000000000010',
              notificationId: '00000000-0000-4000-8000-000000000001',
              type: 'savings',
            },
          },
        },
      },
    } as unknown as Parameters<typeof handleNotificationResponse>[0];

    await handleNotificationResponse(
      response,
      navigate,
      undefined,
      '00000000-0000-4000-8000-000000000010',
      invalidateSavingsWallet
    );

    expect(invalidateSavingsWallet).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('wallet', { action: 'savings' });
  });

  it('does not navigate a savings payload from another merchant', () => {
    const navigate =
      jest.fn<Parameters<typeof handleNotificationResponse>[1]>();
    getStorefrontNotificationNavigationTarget.mockReturnValue(null);

    const invalidateSavingsWallet = jest.fn<() => Promise<void>>();
    handleNotificationResponse(
      {
        notification: {
          request: {
            content: {
              data: {
                goalId: '00000000-0000-4000-8000-000000000002',
                merchantId: '00000000-0000-4000-8000-000000000011',
                notificationId: '00000000-0000-4000-8000-000000000001',
                type: 'savings',
              },
            },
          },
        },
      } as unknown as Parameters<typeof handleNotificationResponse>[0],
      navigate,
      undefined,
      '00000000-0000-4000-8000-000000000010',
      invalidateSavingsWallet
    );

    expect(navigate).not.toHaveBeenCalled();
    expect(invalidateSavingsWallet).not.toHaveBeenCalled();
  });

  it('does not navigate when notification payload has no target', () => {
    const navigate =
      jest.fn<Parameters<typeof handleNotificationResponse>[1]>();
    getStorefrontNotificationNavigationTarget.mockReturnValue(null);

    handleNotificationResponse(
      {
        notification: {
          request: {
            content: {
              data: { type: 'unknown_type' },
            },
          },
        },
      } as unknown as Parameters<typeof handleNotificationResponse>[0],
      navigate
    );

    expect(navigate).not.toHaveBeenCalled();
  });

  it('requests an update check for mobile update notifications instead of navigating', () => {
    const navigate =
      jest.fn<Parameters<typeof handleNotificationResponse>[1]>();
    const requestUpdateCheck = jest.fn();

    handleNotificationResponse(
      {
        notification: {
          request: {
            content: {
              data: { type: 'mobile_update_available' },
            },
          },
        },
      } as unknown as Parameters<typeof handleNotificationResponse>[0],
      navigate,
      requestUpdateCheck
    );

    expect(requestUpdateCheck).toHaveBeenCalledWith('push-notification');
    expect(navigate).not.toHaveBeenCalled();
    expect(getStorefrontNotificationNavigationTarget).not.toHaveBeenCalled();
  });
});

describe('registerForPushNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallOrder.length = 0;
    mockPlatformOS = 'ios';
    mockTelemetryExcluded = false;
    mockExpoConfig = { extra: { eas: { projectId: 'project-id' } } };
  });

  it('acquires a token through the verified staging capability while analytics remains excluded', async () => {
    const previous = {
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      hosted: process.env.EXPO_PUBLIC_HOSTED_STOREFRONT,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    };
    Object.assign(process.env, {
      EXPO_PUBLIC_API_URL: 'https://staging.ogabassey.com',
      EXPO_PUBLIC_HOSTED_STOREFRONT: '1',
      EXPO_PUBLIC_SUPABASE_URL: 'https://staging-auth.ogabassey.com',
    });
    mockTelemetryExcluded = true;
    mockExpoConfig = {
      android: { package: 'com.ogabassey.staging' },
      ios: { bundleIdentifier: 'com.ogabassey.staging' },
      extra: {
        eas: { projectId: '22222222-2222-4222-8222-222222222222' },
        hostedStagingPush: {
          allowedOrigins: [
            'https://staging.ogabassey.com',
            'https://staging-auth.ogabassey.com',
            'https://exp.host',
          ],
          androidPackage: 'com.ogabassey.staging',
          iosBundleIdentifier: 'com.ogabassey.staging',
          projectId: '22222222-2222-4222-8222-222222222222',
        },
        hostedStorefront: true,
      },
    };
    try {
      await expect(registerForPushNotifications()).resolves.toBe(
        'ExponentPushToken[fresh]'
      );
      const notifications = jest.requireMock('expo-notifications') as {
        getExpoPushTokenAsync: jest.Mock;
      };
      expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
        projectId: '22222222-2222-4222-8222-222222222222',
      });
    } finally {
      if (previous.apiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = previous.apiUrl;
      if (previous.hosted === undefined)
        delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
      else process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = previous.hosted;
      if (previous.supabaseUrl === undefined)
        delete process.env.EXPO_PUBLIC_SUPABASE_URL;
      else process.env.EXPO_PUBLIC_SUPABASE_URL = previous.supabaseUrl;
    }
  });

  it('refuses excluded hosted registration with an unverified project', async () => {
    mockTelemetryExcluded = true;
    mockExpoConfig = {
      android: { package: 'com.ogabassey.staging' },
      ios: { bundleIdentifier: 'com.ogabassey.staging' },
      extra: {
        eas: { projectId: 'c6c1897b-cac8-49b0-85f9-3d277aecc379' },
        hostedStagingPush: {
          allowedOrigins: [
            'https://staging.ogabassey.com',
            'https://staging-auth.ogabassey.com',
            'https://exp.host',
          ],
          androidPackage: 'com.ogabassey.staging',
          iosBundleIdentifier: 'com.ogabassey.staging',
          projectId: 'c6c1897b-cac8-49b0-85f9-3d277aecc379',
        },
        hostedStorefront: true,
      },
    };

    await expect(registerForPushNotifications()).resolves.toBeNull();
    const notifications = jest.requireMock('expo-notifications') as {
      getExpoPushTokenAsync: jest.Mock;
    };
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('creates Android notification channels before requesting an Expo push token', async () => {
    mockPlatformOS = 'android';
    const settleChannels: Array<() => void> = [];
    mockSetNotificationChannelAsync.mockImplementation(async (channelId) => {
      mockCallOrder.push(`setNotificationChannelAsync:${channelId}`);
      return await new Promise<void>((resolve) => {
        settleChannels.push(resolve);
      });
    });

    const registration = registerForPushNotifications();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockSetNotificationChannelAsync).toHaveBeenCalledTimes(5);
    expect(mockCallOrder).not.toContain('getExpoPushTokenAsync');

    settleChannels.forEach((resolve) => {
      resolve();
    });
    await registration;

    expect(mockCallOrder).toEqual([
      'setNotificationChannelAsync:orders',
      'setNotificationChannelAsync:payments',
      'setNotificationChannelAsync:savings',
      'setNotificationChannelAsync:promotions',
      'setNotificationChannelAsync:general',
      'getExpoPushTokenAsync',
    ]);
    expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith(
      'payments',
      expect.objectContaining({ name: 'Payments' })
    );
  });

  it('does not log the Expo push token', async () => {
    const token = await registerForPushNotifications();

    expect(token).toBe('ExponentPushToken[fresh]');
    expect(mockLogger.debug.mock.calls.flat()).not.toContain(
      'ExponentPushToken[fresh]'
    );
  });
});
