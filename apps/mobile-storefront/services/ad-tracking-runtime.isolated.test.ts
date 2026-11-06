import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

let mockPlatformOS: 'ios' | 'android' | 'web' = 'android';
let mockTelemetryExcluded = true;

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(),
  randomUUID: jest.fn(),
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
  getTrackingPermissionStatus: jest.fn(async () => ({
    status: 'undetermined',
  })),
  requestTrackingPermissionStatus: jest.fn(async () => ({ status: 'granted' })),
}));

jest.mock('@/lib/storefront-telemetry-excluded', () => ({
  isStorefrontTelemetryExcluded: () => mockTelemetryExcluded,
}));

jest.mock('./ad-tracking-native-modules', () => ({
  loadAdTrackingNativeModules: jest.fn(async () => ({
    AEMReporterIOS: null,
    AppEventsLogger: null,
    FBSettings: null,
    TikTokBusiness: null,
  })),
}));

describe('isolated storefront ad-tracking runtime', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPlatformOS = 'android';
    mockTelemetryExcluded = true;
  });

  afterEach(() => {
    mockTelemetryExcluded = false;
  });

  it('keeps tracking disabled and initialization settled on isolated Android', async () => {
    const runtime = await import('./ad-tracking-runtime');
    const state = await import('./ad-tracking-state');

    await runtime.initAdTracking();

    expect(state.getIsTrackingAllowed()).toBe(false);
    expect(state.getIsInitialized()).toBe(true);
    await expect(runtime.requestTrackingPermission()).resolves.toBe('denied');
    expect(state.getIsTrackingAllowed()).toBe(false);
    expect(state.getIsInitialized()).toBe(true);
  });

  it.each([
    'hosted',
    'local',
  ])('keeps tracking disabled in isolated iOS %s mode', async () => {
    mockPlatformOS = 'ios';
    mockTelemetryExcluded = true;
    const runtime = await import('./ad-tracking-runtime');
    const state = await import('./ad-tracking-state');

    await runtime.initAdTracking();

    expect(state.getIsTrackingAllowed()).toBe(false);
    expect(state.getIsInitialized()).toBe(true);
    await expect(runtime.requestTrackingPermission()).resolves.toBe('denied');
    expect(state.getIsTrackingAllowed()).toBe(false);
    expect(state.getIsInitialized()).toBe(true);
  });
});
