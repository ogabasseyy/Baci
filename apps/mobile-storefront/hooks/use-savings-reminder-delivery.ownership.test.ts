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

it.each([
  'unmount',
  'registration_lost',
] as const)('preserves the root marker when a second hook instance has %s', async (change) => {
  let available = false;
  mockMark.mockImplementation(async () => {
    available = true;
  });
  mockClear.mockImplementation(async () => {
    available = false;
  });
  mockFetch.mockResolvedValue({ deliveryEnabled: true });
  const root = renderHook(() =>
    useSavingsReminderDelivery('user', 'merchant', true)
  );
  await waitFor(() => expect(available).toBe(true));
  const settings = renderHook(
    ({ registered }: { registered: boolean }) =>
      useSavingsReminderDelivery('user', 'merchant', registered),
    { initialProps: { registered: true } }
  );
  try {
    await waitFor(() => expect(mockMark).toHaveBeenCalledTimes(2));
    mockClear.mockClear();
    if (change === 'unmount') settings.unmount();
    else {
      settings.rerender({ registered: false });
    }
    await act(async () => {});
    expect(available).toBe(true);
    expect(mockClear).not.toHaveBeenCalled();
    settings.unmount();
    root.unmount();
    await act(async () => {});
    expect(available).toBe(false);
    expect(mockClear).toHaveBeenCalledTimes(1);
  } finally {
    settings.unmount();
    root.unmount();
    await act(async () => {});
    mockMark.mockResolvedValue(undefined);
    mockClear.mockResolvedValue(undefined);
  }
});

it('clears all owners in the scope when a second hook observes server delivery disabled', async () => {
  let available = false;
  mockMark.mockImplementation(async () => {
    available = true;
  });
  mockClear.mockImplementation(async () => {
    available = false;
  });
  mockFetch.mockResolvedValue({ deliveryEnabled: true });
  const root = renderHook(() =>
    useSavingsReminderDelivery('user', 'merchant', true)
  );
  const settings = renderHook(
    ({ registered }: { registered: boolean }) =>
      useSavingsReminderDelivery('user', 'merchant', registered),
    { initialProps: { registered: true } }
  );
  try {
    await waitFor(() => expect(mockMark).toHaveBeenCalledTimes(2));
    settings.rerender({ registered: false });
    await act(async () => {});
    expect(available).toBe(true);
    expect(mockClear).not.toHaveBeenCalled();
    mockFetch.mockResolvedValue({ deliveryEnabled: false });
    settings.rerender({ registered: true });
    await waitFor(() => expect(available).toBe(false));
    expect(mockClear).toHaveBeenCalledWith({
      apiOrigin: 'https://staging.example.com',
      merchantId: 'merchant',
      userId: 'user',
    });
    mockClear.mockClear();
    settings.unmount();
    await act(async () => {});
    expect(mockClear).toHaveBeenCalledTimes(1);
  } finally {
    settings.unmount();
    root.unmount();
    await act(async () => {});
    mockMark.mockResolvedValue(undefined);
    mockClear.mockResolvedValue(undefined);
  }
});
