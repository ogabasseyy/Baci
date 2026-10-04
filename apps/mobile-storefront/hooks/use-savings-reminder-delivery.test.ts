import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSavingsReminderDelivery } from './use-savings-reminder-delivery';

const mockFetch = jest.fn();
const mockMark = jest.fn().mockResolvedValue(undefined);
const mockClear = jest.fn().mockResolvedValue(undefined);
const mockCancel = jest.fn().mockResolvedValue(undefined);
jest.mock('@/env', () => ({
  EXPO_PUBLIC_API_URL: 'https://staging.example.com',
}));
jest.mock('@/services/savings-notification-inbox', () => ({
  fetchSavingsNotificationInbox: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/services/savings-notification-capability', () => ({
  savingsNotificationCapability: {
    markAvailable: (...args: unknown[]) => mockMark(...args),
    clearAvailable: (...args: unknown[]) => mockClear(...args),
  },
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: () => mockCancel(),
}));

beforeEach(() => jest.clearAllMocks());

it('suppresses local reminders after registration without visiting the inbox', async () => {
  mockFetch.mockResolvedValue({ deliveryEnabled: true });
  renderHook(() => useSavingsReminderDelivery('user', 'merchant', true));
  await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
  expect(mockMark).toHaveBeenCalledWith({
    apiOrigin: 'https://staging.example.com',
    userId: 'user',
    merchantId: 'merchant',
  });
});

it('keeps local reminders when server delivery is unavailable', async () => {
  mockFetch.mockResolvedValue({ deliveryEnabled: false });
  renderHook(() => useSavingsReminderDelivery('user', 'merchant', true));
  await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1));
  expect(mockCancel).not.toHaveBeenCalled();
});

it('does not suppress local reminders without registered push', () => {
  renderHook(() => useSavingsReminderDelivery('user', 'merchant', false));
  expect(mockFetch).not.toHaveBeenCalled();
});

it('ignores a response arriving after sign-out', async () => {
  let resolve!: (value: { deliveryEnabled: boolean }) => void;
  mockFetch.mockReturnValue(
    new Promise((complete) => {
      resolve = complete;
    })
  );
  const { rerender } = renderHook(
    ({ registered }) =>
      useSavingsReminderDelivery('user', 'merchant', registered),
    { initialProps: { registered: true } }
  );
  rerender({ registered: false });
  await act(async () => {
    resolve({ deliveryEnabled: true });
  });
  expect(mockMark).not.toHaveBeenCalled();
  expect(mockCancel).not.toHaveBeenCalled();
});

it('preserves local fallback when capability lookup fails', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  renderHook(() => useSavingsReminderDelivery('user', 'merchant', true));
  await act(async () => {});
  expect(mockCancel).not.toHaveBeenCalled();
});
