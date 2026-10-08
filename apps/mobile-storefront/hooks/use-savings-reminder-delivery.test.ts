import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSavingsReminderDelivery } from './use-savings-reminder-delivery';

const mockFetch = jest.fn();
const mockMark = jest.fn().mockResolvedValue(undefined);
const mockClear = jest.fn().mockResolvedValue(undefined);
const mockSuppress = jest.fn().mockResolvedValue(undefined);
const mockActivate = jest.fn().mockResolvedValue(undefined);
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
  activateDueSavingsReminderNotification: (...args: unknown[]) =>
    mockActivate(...args),
  suppressSavingsReminderNotification: (...args: unknown[]) =>
    mockSuppress(...args),
}));

beforeEach(() => jest.clearAllMocks());

it('suppresses local reminders after registration without visiting the inbox', async () => {
  mockFetch.mockResolvedValue({ deliveryEnabled: true });
  renderHook(() => useSavingsReminderDelivery('user', 'merchant', true));
  await waitFor(() => expect(mockSuppress).toHaveBeenCalledTimes(1));
  expect(mockMark).toHaveBeenCalledWith({
    apiOrigin: 'https://staging.example.com',
    userId: 'user',
    merchantId: 'merchant',
  });
  // The captured scope pins the delayed suppression to this account even
  // if the user switches before the queued operation runs. Suppression
  // retains the pending requests (unlike cancellation) so a later
  // rollback can re-arm local reminders.
  expect(mockSuppress).toHaveBeenCalledWith({
    apiOrigin: 'https://staging.example.com',
    userId: 'user',
    merchantId: 'merchant',
  });
  expect(mockActivate).not.toHaveBeenCalled();
});

it('re-arms local reminders when server delivery is rolled back', async () => {
  mockFetch.mockResolvedValue({ deliveryEnabled: false });
  renderHook(() => useSavingsReminderDelivery('user', 'merchant', true));
  await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockActivate).toHaveBeenCalledTimes(1));
  expect(mockSuppress).not.toHaveBeenCalled();
});

it('re-arms local reminders without registered push instead of only clearing', async () => {
  renderHook(() => useSavingsReminderDelivery('user', 'merchant', false));
  expect(mockFetch).not.toHaveBeenCalled();
  await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockActivate).toHaveBeenCalledTimes(1));
  expect(mockSuppress).not.toHaveBeenCalled();
});

it('ignores a response arriving after sign-out', async () => {
  let resolve!: (value: { deliveryEnabled: boolean }) => void;
  mockFetch.mockReturnValue(
    new Promise((complete) => {
      resolve = complete;
    })
  );
  const { rerender } = renderHook(
    ({ registered }: { registered: boolean }) =>
      useSavingsReminderDelivery('user', 'merchant', registered),
    { initialProps: { registered: true } }
  );
  rerender({ registered: false });
  await act(async () => {
    resolve({ deliveryEnabled: true });
  });
  expect(mockMark).not.toHaveBeenCalled();
  expect(mockSuppress).not.toHaveBeenCalled();
});

it('preserves local fallback when capability lookup fails', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  renderHook(() => useSavingsReminderDelivery('user', 'merchant', true));
  await act(async () => {});
  expect(mockSuppress).not.toHaveBeenCalled();
});

it('clears persisted capability when registration is lost after a successful registration', async () => {
  mockFetch.mockResolvedValue({ deliveryEnabled: true });
  const { rerender } = renderHook(
    ({ registered }: { registered: boolean }) =>
      useSavingsReminderDelivery('user', 'merchant', registered),
    { initialProps: { registered: true } }
  );
  await waitFor(() => expect(mockMark).toHaveBeenCalledTimes(1));
  rerender({ registered: false });
  await waitFor(() =>
    expect(mockClear).toHaveBeenCalledWith({
      apiOrigin: 'https://staging.example.com',
      merchantId: 'merchant',
      userId: 'user',
    })
  );
  // Lost registration re-arms retained local pendings — the customer must
  // not end up with neither server nor local reminders.
  await waitFor(() => expect(mockActivate).toHaveBeenCalledTimes(1));
});

it('clears a persisted marker on boot with failed rotation or unregistered push', async () => {
  renderHook(() => useSavingsReminderDelivery('user', 'merchant', false));
  await waitFor(() =>
    expect(mockClear).toHaveBeenCalledWith({
      apiOrigin: 'https://staging.example.com',
      merchantId: 'merchant',
      userId: 'user',
    })
  );
  await waitFor(() => expect(mockActivate).toHaveBeenCalledTimes(1));
  expect(mockSuppress).not.toHaveBeenCalled();
});

it.each([
  'userId',
  'merchantId',
] as const)('ignores the old inbox response after changing %s', async (field) => {
  let resolve!: (value: { deliveryEnabled: boolean }) => void;
  mockFetch
    .mockReturnValueOnce(
      new Promise((complete) => {
        resolve = complete;
      })
    )
    .mockResolvedValue({ deliveryEnabled: true });
  const oldScope = { userId: 'user', merchantId: 'merchant' };
  const nextScope = { ...oldScope, [field]: 'next' };
  const { rerender } = renderHook(
    ({ userId, merchantId }: { userId: string; merchantId: string }) =>
      useSavingsReminderDelivery(userId, merchantId, true),
    { initialProps: oldScope }
  );
  rerender(nextScope);
  await waitFor(() => expect(mockSuppress).toHaveBeenCalledTimes(1));
  await act(async () => {
    resolve({ deliveryEnabled: true });
  });
  expect(mockMark).toHaveBeenCalledTimes(1);
  expect(mockMark).toHaveBeenCalledWith({
    apiOrigin: 'https://staging.example.com',
    ...nextScope,
  });
  expect(mockClear).toHaveBeenCalledWith({
    apiOrigin: 'https://staging.example.com',
    ...oldScope,
  });
});

it('clears a late persisted write before re-registering the same account', async () => {
  let completeMark!: () => void;
  let available = false;
  mockFetch.mockResolvedValue({ deliveryEnabled: true });
  mockMark
    .mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        completeMark = resolve;
      });
      available = true;
    })
    .mockImplementationOnce(async () => {
      available = true;
    });
  mockClear.mockImplementation(async () => {
    available = false;
  });
  const { rerender, unmount } = renderHook(
    ({ registered }: { registered: boolean }) =>
      useSavingsReminderDelivery('user', 'merchant', registered),
    { initialProps: { registered: true } }
  );
  await waitFor(() => expect(mockMark).toHaveBeenCalledTimes(1));
  rerender({ registered: false });
  rerender({ registered: true });
  await act(async () => {
    completeMark();
  });
  await waitFor(() => expect(mockMark).toHaveBeenCalledTimes(2));
  expect(available).toBe(true);
  expect(mockSuppress).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => {});
  expect(available).toBe(false);
  mockClear.mockResolvedValue(undefined);
});

it('never writes an unscoped capability when authentication or merchant is absent', async () => {
  const { rerender } = renderHook(
    ({
      userId,
      merchantId,
    }: {
      userId: string | null;
      merchantId: string | null;
    }) => useSavingsReminderDelivery(userId, merchantId, false),
    {
      initialProps: { userId: null, merchantId: 'merchant' } as {
        userId: string | null;
        merchantId: string | null;
      },
    }
  );
  rerender({ userId: 'user', merchantId: null });
  await act(async () => {});
  expect(mockClear).not.toHaveBeenCalled();
  expect(mockMark).not.toHaveBeenCalled();
});
