import { beforeEach, jest } from '@jest/globals';

export const mockDebug = jest.fn();
export const mockError = jest.fn();
export const mockInfo = jest.fn();
export const mockWarn = jest.fn();
export const mockGetRandomBytesAsync = jest.fn();
export const mockRandomUUID = jest.fn();
export const mockGetTrackingPermissionStatus =
  jest.fn<() => Promise<{ status: string }>>();
export const mockRequestTrackingPermissionStatus =
  jest.fn<() => Promise<{ status: string }>>();

export type MockFBSettings = {
  initializeSDK?: () => void;
  setAdvertiserTrackingEnabled?: (
    enabled: boolean
  ) => Promise<boolean> | boolean | undefined;
};

export type MockAppEventsLogger = {
  logEvent?: (
    name: string,
    valueToSumOrParams?: number | Record<string, unknown>,
    params?: Record<string, unknown>
  ) => void;
  logPurchase?: (
    amount: number,
    currency: string,
    params?: Record<string, unknown>
  ) => void;
};

export type MockAEMReporterIOS = {
  logAEMEvent?: (
    name: string,
    value: number,
    currency: string,
    params: Record<string, unknown>
  ) => void;
};

export type MockTikTokBusiness = {
  initialize?: () => boolean | Promise<boolean>;
  isInitialized?: () => boolean;
  trackEvent?: (name: string, eventId?: string, eventData?: unknown[]) => void;
};

export type MockNativeModules = {
  AEMReporterIOS: MockAEMReporterIOS | null;
  AppEventsLogger: MockAppEventsLogger | null;
  FBSettings: MockFBSettings | null;
  TikTokBusiness: MockTikTokBusiness | null;
};

export const mockLoadAdTrackingNativeModules =
  jest.fn<
    (options?: {
      onTikTokReady?: (
        tikTok: MockTikTokBusiness | null
      ) => void | Promise<void>;
      onFacebookReady?: (facebook: {
        FBSettings: MockFBSettings | null;
        AppEventsLogger: MockAppEventsLogger | null;
        AEMReporterIOS: MockAEMReporterIOS | null;
      }) => void | Promise<void>;
    }) => Promise<MockNativeModules>
  >();

let mockPlatformOS: 'ios' | 'android' | 'web' = 'ios';
let mockExpoConfigExtra: Record<string, unknown> = {};

export function setMockExpoConfigExtra(extra: Record<string, unknown>) {
  mockExpoConfigExtra = extra;
}

export function createNativeModules(
  overrides: Partial<MockNativeModules> = {}
): MockNativeModules {
  return {
    AEMReporterIOS: null,
    AppEventsLogger: null,
    FBSettings: null,
    TikTokBusiness: null,
    ...overrides,
  };
}

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return {
        extra: mockExpoConfigExtra,
      };
    },
  },
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: mockGetRandomBytesAsync,
  randomUUID: mockRandomUUID,
}));

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: mockDebug,
    error: mockError,
    info: mockInfo,
    warn: mockWarn,
  }),
}));

jest.mock('@/lib/tracking-transparency', () => ({
  getTrackingPermissionStatus: mockGetTrackingPermissionStatus,
  requestTrackingPermissionStatus: mockRequestTrackingPermissionStatus,
}));

jest.mock('./ad-tracking-native-modules', () => ({
  loadAdTrackingNativeModules: mockLoadAdTrackingNativeModules,
}));

export function installAdTrackingRuntimeTestReset() {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPlatformOS = 'ios';
    mockExpoConfigExtra = {
      apiUrl: 'https://api.test',
      facebookAppId: 'fb-test',
      facebookClientToken: 'client-test',
      tiktokBusiness: {
        isConfigured: false,
      },
    };
    mockGetTrackingPermissionStatus.mockResolvedValue({ status: 'denied' });
    mockRequestTrackingPermissionStatus.mockResolvedValue({
      status: 'granted',
    });
    mockLoadAdTrackingNativeModules.mockResolvedValue(createNativeModules());
  });
}
