import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { walletPayPurchaseKeys } from '@/components/wallet-pay/wallet-pay-purchase-keys';

// The real key store, request identity and (deterministic) expo-crypto
// stand-in: only the network, wallet and pending poller are faked.
let mockUserId = 'user-a';
const mockSubmit = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockPending = {
  pending: null,
  terminal: null,
  paused: false,
  start: jest.fn(),
  clear: jest.fn(),
  clearTerminal: jest.fn(),
};
jest.mock('./submit-imei-check', () => ({
  submitImeiCheck: (...args: unknown[]) => mockSubmit(...args),
}));
jest.mock('./use-imei-pending-lookup', () => ({
  useImeiPendingLookup: () => mockPending,
}));
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: { wallet: { balance: 50_000 } },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/stores/auth-store', () => {
  const state = () => ({
    session: { access_token: 'test-token', user: { id: mockUserId } },
    user: { id: mockUserId },
    customer: { id: 'customer' },
    merchantId: 'merchant',
  });
  return {
    useAuthStore: Object.assign(
      (select: (value: unknown) => unknown) => select(state()),
      { getState: state }
    ),
  };
});
jest.mock('./use-imei-wallet-pay', () => ({
  useImeiWalletPay: () => ({
    sheet: { step: 'closed', back: jest.fn(), close: jest.fn() },
    sheetProps: {},
    view: { covers: () => false, savingsKobo: null },
    waitsForWallet: false,
    covers: () => false,
    retains: async () => false,
    open: jest.fn(),
  }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}));

import { useImeiCheckFlow } from './use-imei-check-flow';

const IMEI = '490154203237518';
const keyOf = (call: number) =>
  (mockSubmit.mock.calls[call]?.[0] as { idempotencyKey: string })
    .idempotencyKey;
const complete = {
  response: { ok: true, status: 200 },
  rawData: {
    success: true,
    status: 'complete',
    lookupId: '22222222-2222-4222-8222-222222222222',
    data: {
      imei: IMEI,
      device: 'iPhone 13',
      modelNumber: '',
      status: 'Clean',
      icloud: 'Unknown',
      icloudLock: 'Unknown',
      simLock: 'Unknown',
      blacklistStatus: 'Clean',
      carrier: 'Unknown',
      deviceImage: '',
      score: 90,
      deviceType: 'apple',
      verdict: 'Clean',
      verdictType: 'safe',
    },
  },
};

/** An app restart: the screen is gone and every in-memory copy with it. */
function relaunch(unmount: () => void) {
  unmount();
  walletPayPurchaseKeys.resetMemory();
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockSubmit.mockReset();
  mockUserId = 'user-a';
  await AsyncStorage.clear();
  walletPayPurchaseKeys.resetMemory();
});

describe('bugfix: a killed app paid a store credit IMEI check twice', () => {
  it('reuses the same key when the app is killed between send and answer', async () => {
    // The first request goes out and its answer never arrives (app killed).
    mockSubmit.mockImplementationOnce(() => new Promise(() => undefined));
    const first = renderHook(() =>
      useImeiCheckFlow('smartphone', 'https://test.invalid')
    );
    act(() => {
      void first.result.current.handleVerify('blacklist', IMEI);
    });
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    relaunch(first.unmount);

    mockSubmit.mockResolvedValueOnce(complete);
    const second = renderHook(() =>
      useImeiCheckFlow('smartphone', 'https://test.invalid')
    );
    await act(async () => {
      await second.result.current.handleVerify('blacklist', IMEI);
    });

    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('mints a fresh key once the server reported a final result', async () => {
    mockSubmit.mockResolvedValueOnce(complete).mockResolvedValueOnce(complete);
    const { result } = renderHook(() =>
      useImeiCheckFlow('smartphone', 'https://test.invalid')
    );
    await act(async () => {
      await result.current.handleVerify('blacklist', IMEI);
    });
    act(() => result.current.handleReset());
    await act(async () => {
      await result.current.handleVerify('blacklist', IMEI);
    });

    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it('never hands one account the key another account saved', async () => {
    mockSubmit.mockImplementationOnce(() => new Promise(() => undefined));
    const first = renderHook(() =>
      useImeiCheckFlow('smartphone', 'https://test.invalid')
    );
    act(() => {
      void first.result.current.handleVerify('blacklist', IMEI);
    });
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    relaunch(first.unmount);

    mockUserId = 'user-b';
    mockSubmit.mockResolvedValueOnce(complete);
    const second = renderHook(() =>
      useImeiCheckFlow('smartphone', 'https://test.invalid')
    );
    await act(async () => {
      await second.result.current.handleVerify('blacklist', IMEI);
    });

    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it('saves the key with the pending lookup the server started', async () => {
    mockSubmit.mockResolvedValueOnce({
      response: { ok: true, status: 202 },
      rawData: {
        success: true,
        status: 'pending',
        lookupId: '33333333-3333-4333-8333-333333333333',
        pollAfterMs: 2000,
      },
    });
    const { result } = renderHook(() =>
      useImeiCheckFlow('smartphone', 'https://test.invalid')
    );
    await act(async () => {
      await result.current.handleVerify('blacklist', IMEI);
    });

    expect(mockPending.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupId: '33333333-3333-4333-8333-333333333333',
        request: {
          key: keyOf(0),
          purchase: expect.stringMatching(/^imei-credit\|user-a\|/),
        },
      })
    );
  });

  it('shows try again and pays nothing when the key cannot be saved', async () => {
    const setItem = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValue(new Error('disk full'));
    const { result } = renderHook(() =>
      useImeiCheckFlow('smartphone', 'https://test.invalid')
    );
    await act(async () => {
      await result.current.handleVerify('blacklist', IMEI);
    });
    setItem.mockRestore();

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/try again/i);
    expect(result.current.isLoading).toBe(false);
  });
});
