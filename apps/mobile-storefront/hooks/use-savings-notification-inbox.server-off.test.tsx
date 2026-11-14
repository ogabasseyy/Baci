import { renderHook, waitFor } from '@testing-library/react-native';
import { fetchSavingsNotificationInbox } from '@/services/savings-notification-inbox';
import { useSavingsNotificationInbox } from './use-savings-notification-inbox';

jest.mock('@/services/savings-notification-inbox', () => ({
  fetchSavingsNotificationInbox: jest.fn(),
  markSavingsNotificationRead: jest.fn(),
  updateSavingsNotificationPreferences: jest.fn(),
}));
jest.mock('@/services/savings-notification-capability', () => ({
  savingsNotificationCapability: {
    clearAvailable: jest.fn(async () => undefined),
    markAvailable: jest.fn(async () => undefined),
  },
}));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'https://api.baci.test' }));
jest.mock('@/services/savings-reminder-notifications', () => ({
  suppressSavingsReminderNotification: jest.fn(async () => false),
}));
jest.mock('@/lib/push-token-storage', () => ({
  getRegisteredPushToken: jest.fn(async () => null),
}));

const merchantId = '00000000-0000-4000-8000-000000000010';

// With the server off the inbox read fails at the transport: the customer
// sees plain wording and no invented notifications, never "fetch failed".
describe('server keeps PiggyVest off: savings notification inbox', () => {
  it('reports an unreachable inbox in plain words with no notifications', async () => {
    jest
      .mocked(fetchSavingsNotificationInbox)
      .mockRejectedValue(
        new Error('fetch failed: Could not connect to the server.')
      );
    const { result } = renderHook(() =>
      useSavingsNotificationInbox({ enabled: true, merchantId, userId: 'u' })
    );
    await waitFor(() =>
      expect(result.current.error).toBe(
        'Unable to update savings notifications. Please try again.'
      )
    );
    expect(result.current.notifications).toEqual([]);
  });
});
