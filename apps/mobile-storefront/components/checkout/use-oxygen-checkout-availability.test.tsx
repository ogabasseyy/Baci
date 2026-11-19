import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  getOxygenStagingProfile,
  type OxygenStagingProfile,
} from '@/lib/oxygen-staging-profile';
import { oxygenNativeSession } from '@/services/oxygen/native-session';
import type { CartItem } from '@/stores/cart-store';
import { useOxygenCheckoutAvailability } from './use-oxygen-checkout-availability';

const mockCapabilities = jest.fn();
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
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
  authBaseUrl: 'https://auth.example.com',
  apiOrigin: 'https://api.example.com',
  merchantId: 'merchant',
  merchantSlug: 'ogabassey',
} as OxygenStagingProfile;

let listener: ((state: NetInfoState) => void) | undefined;

function setOnline(isOnline: boolean) {
  listener?.({
    isConnected: isOnline,
    isInternetReachable: isOnline,
  } as NetInfoState);
}

beforeEach(() => {
  listener = undefined;
  jest.mocked(NetInfo.addEventListener).mockImplementation((next) => {
    listener = next;
    setOnline(true);
    return () => {
      listener = undefined;
    };
  });
  jest.mocked(oxygenNativeSession).mockClear();
  mockCapabilities.mockReset().mockResolvedValue(undefined);
  jest.mocked(getOxygenStagingProfile).mockReturnValue(profile);
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
  jest.mocked(getOxygenStagingProfile).mockReturnValue({
    ...profile,
    merchantId: 'another-merchant',
  });
  rerender({ items: [] });
  await act(async () => {});
  expect(result.current.disabledReason).toContain('linked staging customer');
  expect(oxygenNativeSession).not.toHaveBeenCalled();
});

it('discards the previous deployment readiness immediately on profile change', async () => {
  const { rerender, result } = renderHook(() =>
    useOxygenCheckoutAvailability([])
  );
  await waitFor(() => expect(result.current.disabledReason).toBeUndefined());
  jest.mocked(getOxygenStagingProfile).mockReturnValue({
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

it('recovers from one transient probe failure while connectivity stays online', async () => {
  jest.useFakeTimers();
  try {
    mockCapabilities.mockRejectedValueOnce(
      new Error('temporarily unavailable')
    );
    const { result } = renderHook(() => useOxygenCheckoutAvailability([]));
    await act(async () => {});
    expect(mockCapabilities).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(3000));
    expect(mockCapabilities).toHaveBeenCalledTimes(2);
    expect(result.current.disabledReason).toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});
