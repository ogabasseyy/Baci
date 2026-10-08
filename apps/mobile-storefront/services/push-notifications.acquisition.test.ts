import type { DevicePushToken } from 'expo-notifications';

const mockCalls: string[] = [];
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetExpoToken = jest.fn();
const mockCapability = jest.fn();
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('@/lib/hosted-staging-push-capability', () => ({
  getNativePushRegistration: () => mockCapability(),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('@/services/push-notification-channels', () => ({
  ensureAndroidNotificationChannels: jest.fn(async () => {
    mockCalls.push('channel');
  }),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoToken(...args),
  setNotificationHandler: jest.fn(),
}));

const { registerForPushNotifications } =
  require('./push-notifications') as typeof import('./push-notifications');

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockCapability.mockReturnValue({
    projectId: '22222222-2222-4222-8222-222222222222',
  });
  mockGetPermissions.mockImplementation(async () => {
    mockCalls.push('permission');
    return { status: 'denied' };
  });
  mockRequestPermissions.mockResolvedValue({ status: 'granted' });
  mockGetExpoToken.mockResolvedValue({ data: 'ExpoPushToken[fixture]' });
});

it('creates Android channels before requesting permission from a fresh install', async () => {
  await registerForPushNotifications();
  expect(mockCalls.slice(0, 2)).toEqual(['channel', 'permission']);
});

it('does not prompt again during an automatic foreground refresh', async () => {
  const result = await registerForPushNotifications({
    requestPermission: false,
  });
  expect(result).toBeNull();
  expect(mockRequestPermissions).not.toHaveBeenCalled();
  expect(mockGetExpoToken).not.toHaveBeenCalled();
});

it('passes the rotated native token directly to Expo to avoid requesting it recursively', async () => {
  mockGetPermissions.mockResolvedValue({ status: 'granted' });
  const devicePushToken: DevicePushToken = {
    type: 'android',
    data: 'native-fixture',
  };
  await registerForPushNotifications({
    devicePushToken,
    requestPermission: false,
  });
  expect(mockGetExpoToken).toHaveBeenCalledWith({
    projectId: '22222222-2222-4222-8222-222222222222',
    devicePushToken,
  });
});

it('does not contact Expo without the native capability', async () => {
  mockCapability.mockReturnValue(null);
  expect(await registerForPushNotifications()).toBeNull();
  expect(mockGetExpoToken).not.toHaveBeenCalled();
});
