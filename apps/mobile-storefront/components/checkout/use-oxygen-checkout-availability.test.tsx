import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getOxygenMobileProfile } from '@/lib/oxygen-mobile-profile';
import { getOxygenStagingProfile } from '@/lib/oxygen-staging-profile';
import { oxygenNativeSession } from '@/services/oxygen/native-session';
import type { CartItem } from '@/stores/cart-store';
import { useOxygenCheckoutAvailability } from './use-oxygen-checkout-availability';

const mockCapabilities = jest.fn();
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
}));
jest.mock('@/lib/oxygen-mobile-profile', () => ({
  getOxygenMobileProfile: jest.fn(),
}));
jest.mock('@/lib/oxygen-staging-profile', () => ({
  getOxygenStagingProfile: jest.fn(),
}));
jest.mock('@/services/oxygen/native-session', () => ({
  oxygenNativeSession: jest.fn(() => ({ capabilities: mockCapabilities })),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: jest.fn((select) =>
    select({
      user: { id: 'buyer' },
      customer: { id: 'customer', user_id: 'buyer', merchant_id: 'merchant' },
      merchantId: 'merchant',
    })
  ),
}));

const profile = {
  environment: 'staging' as const,
  authOrigin: 'https://auth.example.com',
  storagePrefix: 'oxygen-staging:',
  authBaseUrl: 'https://auth.example.com',
  apiOrigin: 'https://api.example.com',
  merchantId: 'merchant',
  merchantSlug: 'ogabassey',
};

let listener: ((state: NetInfoState) => void) | undefined;

function setOnline(isOnline: boolean) {
  listener?.({
    isConnected: isOnline,
    isInternetReachable: isOnline,
  } as NetInfoState);
}

beforeEach(() => {
  listener = undefined;
  jest.mocked(getOxygenStagingProfile).mockReturnValue(null);
  jest.mocked(NetInfo.addEventListener).mockImplementation((next) => {
    listener = next;
    setOnline(true);
    return () => {
      listener = undefined;
    };
  });
  jest.mocked(oxygenNativeSession).mockClear();
  mockCapabilities.mockReset().mockResolvedValue(undefined);
  jest.mocked(getOxygenMobileProfile).mockReturnValue(profile);
});

it('does not probe for a voucher cart or mismatched staging customer', async () => {
  const voucher = {
    voucher_token: 'test-token',
    voucher_award_id: 'award-id',
  } as CartItem;
  const { rerender, result } = renderHook(
    ({ items }: { items: CartItem[] }) => useOxygenCheckoutAvailability(items),
    { initialProps: { items: [voucher] } }
  );
  await act(async () => {});
  expect(result.current.disabledReason).toContain('voucher');
  expect(oxygenNativeSession).not.toHaveBeenCalled();
  jest.mocked(getOxygenMobileProfile).mockReturnValue({
    ...profile,
    merchantId: 'another-merchant',
  });
  rerender({ items: [] });
  await act(async () => {});
  expect(result.current.disabledReason).toContain('linked customer');
  expect(oxygenNativeSession).not.toHaveBeenCalled();
});

it('discards the previous deployment readiness immediately on profile change', async () => {
  const { rerender, result } = renderHook(() =>
    useOxygenCheckoutAvailability([])
  );
  await waitFor(() => expect(result.current.disabledReason).toBeUndefined());
  jest.mocked(getOxygenMobileProfile).mockReturnValue({
    ...profile,
    apiOrigin: 'https://new-api.example.com',
  });
  let resolveProbe: () => void = () => undefined;
  mockCapabilities.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      resolveProbe = resolve;
    })
  );
  rerender(undefined);
  expect(result.current.disabledReason).toContain('Checking');
  await act(async () => resolveProbe());
  expect(result.current.disabledReason).toBeUndefined();
});

it('rechecks availability when connectivity returns after a failed probe', async () => {
  mockCapabilities.mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(() => useOxygenCheckoutAvailability([]));
  await waitFor(() =>
    expect(result.current.disabledReason).toContain('unavailable')
  );
  act(() => setOnline(false));
  expect(mockCapabilities).toHaveBeenCalledTimes(1);
  act(() => setOnline(true));
  await waitFor(() => expect(result.current.disabledReason).toBeUndefined());
  expect(mockCapabilities).toHaveBeenCalledTimes(2);
});

it('waits for known connectivity before checking readiness', async () => {
  jest.mocked(NetInfo.addEventListener).mockImplementationOnce((next) => {
    listener = next;
    next({ isConnected: null, isInternetReachable: null } as NetInfoState);
    return () => {};
  });
  const { result } = renderHook(() => useOxygenCheckoutAvailability([]));
  await act(async () => {});
  expect(result.current.disabledReason).toContain('Checking');
  expect(mockCapabilities).not.toHaveBeenCalled();
  act(() => setOnline(true));
  await waitFor(() => expect(result.current.disabledReason).toBeUndefined());
});

it('recovers with bounded backoff after two failures while connectivity stays online', async () => {
  jest.useFakeTimers();
  try {
    mockCapabilities
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockRejectedValueOnce(new Error('still unavailable'));
    const { result } = renderHook(() => useOxygenCheckoutAvailability([]));
    await act(async () => {});
    expect(mockCapabilities).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(3000));
    expect(mockCapabilities).toHaveBeenCalledTimes(2);
    await act(async () => jest.advanceTimersByTime(8000));
    expect(mockCapabilities).toHaveBeenCalledTimes(3);
    expect(result.current.disabledReason).toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});

it('checks staging directly when reachability stays unknown', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(NetInfo.addEventListener).mockImplementationOnce((next) => {
      next({ isConnected: true, isInternetReachable: null } as NetInfoState);
      return () => {};
    });
    const { result } = renderHook(() => useOxygenCheckoutAvailability([]));
    expect(result.current.disabledReason).toContain('Checking');
    await act(async () => jest.advanceTimersByTime(2000));
    expect(mockCapabilities).toHaveBeenCalledTimes(1);
    expect(result.current.disabledReason).toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});

it('leaves the checking state when the availability request hangs', async () => {
  jest.useFakeTimers();
  try {
    mockCapabilities.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useOxygenCheckoutAvailability([]));
    await act(async () => {});
    await act(async () => jest.advanceTimersByTime(10000));
    expect(result.current.disabledReason).toContain('unavailable');
  } finally {
    jest.useRealTimers();
  }
});

it('keeps Oxygen hidden in production until the server admits the linked customer', async () => {
  jest.mocked(getOxygenMobileProfile).mockReturnValue({
    ...profile,
    environment: 'production',
  });
  let allow!: () => void;
  mockCapabilities.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      allow = resolve;
    })
  );

  const { result } = renderHook(() => useOxygenCheckoutAvailability([]));
  expect(result.current.visible).toBe(false);
  await act(async () => allow());
  await waitFor(() => expect(result.current.visible).toBe(true));
});

it.each([
  ['http://127.0.0.1:3000', true],
  ['https://staging.example.com', false],
])('uses the LAN reachability exception only for pinned localhost: %s', async (apiOrigin, available) => {
  const staging = { ...profile, apiOrigin };
  jest.mocked(getOxygenMobileProfile).mockReturnValue(staging);
  jest.mocked(getOxygenStagingProfile).mockReturnValue({
    ...staging,
    expectedAuthIssuer: 'https://auth.example.com/auth/v1',
    publicKey: 'staging-test-key',
    appId: 'com.ogabassey.oxygenstaging',
  });
  jest.mocked(NetInfo.addEventListener).mockImplementationOnce((next) => {
    next({ isConnected: true, isInternetReachable: false } as NetInfoState);
    return () => {};
  });
  const { result } = renderHook(() => useOxygenCheckoutAvailability([]));
  await act(async () => {});
  if (available) {
    expect(mockCapabilities).toHaveBeenCalledTimes(1);
    expect(result.current.disabledReason).toBeUndefined();
  } else {
    expect(mockCapabilities).not.toHaveBeenCalled();
    expect(result.current.disabledReason).toContain('unavailable');
  }
});
