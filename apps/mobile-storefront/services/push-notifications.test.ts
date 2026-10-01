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
const mockCallOrder: string[] = [];
const mockSetNotificationChannelAsync = jest.fn(async (channelId: string) => {
  mockCallOrder.push(`setNotificationChannelAsync:${channelId}`);
});

jest.mock('@baci/shared/lib', () => ({
  getStorefrontNotificationNavigationTarget: jest.fn(),
}));

jest.mock('expo-application', () => ({
  nativeBuildVersion: '646',
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'project-id' } } },
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

    expect(mockSetNotificationChannelAsync).toHaveBeenCalledTimes(4);
    expect(mockCallOrder).not.toContain('getExpoPushTokenAsync');

    settleChannels.forEach((resolve) => {
      resolve();
    });
    await registration;

    // orders, payments, promotions, general — the payments channel must exist
    // before a wallet-credited push targets it on Android 8+.
    expect(mockCallOrder).toEqual([
      'setNotificationChannelAsync:orders',
      'setNotificationChannelAsync:payments',
      'setNotificationChannelAsync:promotions',
      'setNotificationChannelAsync:general',
      'getExpoPushTokenAsync',
    ]);
    expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith(
      'payments',
      expect.objectContaining({ name: 'Payments' })
    );
  });
});
