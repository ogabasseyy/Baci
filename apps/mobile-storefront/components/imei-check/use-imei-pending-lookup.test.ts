import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/imei-poll-client', () => ({
  pollImeiLookup: jest.fn(),
}));

import { pendingImeiStorageKey } from '@/lib/imei-pending-storage';
import { pollImeiLookup } from '@/lib/imei-poll-client';
import { useImeiPendingLookup } from './use-imei-pending-lookup';

const mockPollImeiLookup = jest.mocked(pollImeiLookup);

describe('useImeiPendingLookup', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('persists and resolves a pending mobile lookup', async () => {
    mockPollImeiLookup.mockResolvedValue({
      kind: 'complete',
      result: {
        blacklistStatus: 'Clean',
        carrier: 'Unlocked',
        device: 'iPhone',
        deviceImage: '',
        deviceType: 'apple',
        icloud: 'Off',
        icloudLock: 'Off',
        imei: '490154203237518',
        modelNumber: 'A2638',
        score: 100,
        simLock: 'Unlocked',
        status: 'Clean',
        verdict: 'Safe to buy',
        verdictType: 'safe',
      },
    });
    const { result } = renderHook(() =>
      useImeiPendingLookup({
        accessToken: 'token',
        apiBaseUrl: 'https://shop.example.com',
        customerId: 'customer-1',
        merchantId: 'merchant-1',
      })
    );

    await act(async () => {
      await result.current.start({
        lookupId: '11111111-1111-4111-8111-111111111111',
        pollAfterMs: 0,
        tier: 'blacklist',
      });
    });

    await waitFor(() => expect(result.current.terminal?.kind).toBe('complete'));
    expect(result.current.terminal).toMatchObject({
      lookupId: '11111111-1111-4111-8111-111111111111',
    });
    await expect(
      AsyncStorage.getItem(pendingImeiStorageKey('merchant-1', 'customer-1'))
    ).resolves.toBeNull();
  });

  it('continues low-frequency polling for a stale restored lookup', async () => {
    jest.useFakeTimers();
    const key = pendingImeiStorageKey('merchant-1', 'customer-1');
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        lookupId: '11111111-1111-4111-8111-111111111111',
        tier: 'blacklist',
        ownerUserId: 'user-1',
      })
    );
    mockPollImeiLookup.mockResolvedValue({
      kind: 'pending',
      pollAfterMs: 5000,
    });
    const { result } = renderHook(() =>
      useImeiPendingLookup({
        accessToken: 'token',
        userId: 'user-1',
        apiBaseUrl: 'https://shop.example.com',
        customerId: 'customer-1',
        merchantId: 'merchant-1',
      })
    );
    await act(async () => undefined);
    expect(result.current.paused).toBe(true);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });

    expect(mockPollImeiLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupId: '11111111-1111-4111-8111-111111111111',
      })
    );
    jest.useRealTimers();
  });
});

it('keeps polling in memory when optional pending storage fails', async () => {
  const { result } = renderHook(() =>
    useImeiPendingLookup({
      accessToken: 'token',
      apiBaseUrl: 'https://test.invalid',
      customerId: 'customer-1',
      merchantId: 'merchant-1',
    })
  );
  jest
    .spyOn(AsyncStorage, 'setItem')
    .mockRejectedValueOnce(new Error('Storage full'));
  mockPollImeiLookup.mockResolvedValue({ kind: 'retry', pollAfterMs: 60000 });
  await act(async () => {
    await result.current.start({
      lookupId: '11111111-1111-4111-8111-111111111111',
      pollAfterMs: 0,
      tier: 'blacklist',
      device: 'smartphone',
    });
  });
  await waitFor(() => expect(mockPollImeiLookup).toHaveBeenCalled());
  expect(result.current.pending?.device).toBe('smartphone');
});

it('does not report failed persistence without a visible pending lookup', async () => {
  await AsyncStorage.clear();
  const { result, rerender } = renderHook(
    ({ customerId }: { customerId: string }) =>
      useImeiPendingLookup({
        apiBaseUrl: 'https://test.invalid',
        customerId,
        merchantId: 'merchant-1',
      }),
    { initialProps: { customerId: 'customer-1' } }
  );
  expect(result.current.pending).toBeNull();
  expect(result.current.canResume).toBe(true);
  jest
    .spyOn(AsyncStorage, 'setItem')
    .mockRejectedValueOnce(new Error('Storage full'));
  await act(async () => {
    await result.current.start({
      lookupId: '11111111-1111-4111-8111-111111111111',
      pollAfterMs: 60000,
      tier: 'blacklist',
    });
  });
  expect(result.current.canResume).toBe(false);
  await act(async () => {
    rerender({ customerId: 'customer-2' });
  });
  expect(result.current.pending).toBeNull();
  expect(result.current.canResume).toBe(true);
});

describe('bugfix: a saved pending check is only resumed by the user who started it', () => {
  const key = pendingImeiStorageKey('merchant-1', 'customer-1');
  const saved = (ownerUserId?: string) =>
    AsyncStorage.setItem(
      key,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        lookupId: '11111111-1111-4111-8111-111111111111',
        tier: 'blacklist',
        ...(ownerUserId ? { ownerUserId } : {}),
      })
    );
  const renderFor = (userId: string) =>
    renderHook(() =>
      useImeiPendingLookup({
        accessToken: 'token',
        userId,
        apiBaseUrl: 'https://test.invalid',
        customerId: 'customer-1',
        merchantId: 'merchant-1',
      })
    );
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockPollImeiLookup.mockResolvedValue({ kind: 'retry', pollAfterMs: 60000 });
  });

  it('neither shows nor deletes the previous user record while sign-in pairs a new user with the old customer', async () => {
    await saved('user-a');
    const { result } = renderFor('user-b');
    await act(async () => undefined);
    expect(result.current.pending).toBeNull();
    expect(mockPollImeiLookup).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(key)).resolves.not.toBeNull();
  });

  it('does not resume an unowned legacy record', async () => {
    await saved();
    const { result } = renderFor('user-a');
    await act(async () => undefined);
    expect(result.current.pending).toBeNull();
  });

  it('resumes the same user record and saves its owner on start', async () => {
    await saved('user-a');
    const { result } = renderFor('user-a');
    await waitFor(() => expect(result.current.pending).not.toBeNull());
    await act(async () => {
      await result.current.start({
        lookupId: '22222222-2222-4222-8222-222222222222',
        pollAfterMs: 60000,
        tier: 'blacklist',
      });
    });
    expect(JSON.parse((await AsyncStorage.getItem(key)) ?? '{}')).toMatchObject(
      {
        ownerUserId: 'user-a',
      }
    );
  });
});

it('bugfix: a clear that finishes after a newer start keeps the newer lookup', async () => {
  await AsyncStorage.clear();
  let finishRemove!: () => void;
  const { result } = renderHook(() =>
    useImeiPendingLookup({
      accessToken: 'token',
      userId: 'user-a',
      apiBaseUrl: 'https://test.invalid',
      customerId: 'customer-1',
      merchantId: 'merchant-1',
    })
  );
  await act(async () => undefined);
  mockPollImeiLookup.mockResolvedValue({ kind: 'retry', pollAfterMs: 60000 });
  jest.spyOn(AsyncStorage, 'removeItem').mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        finishRemove = done;
      })
  );
  let clearing!: Promise<void>;
  act(() => {
    clearing = result.current.clear();
  });
  await act(async () => {
    await result.current.start({
      lookupId: '33333333-3333-4333-8333-333333333333',
      pollAfterMs: 60000,
      tier: 'blacklist',
    });
  });
  await act(async () => {
    finishRemove();
    await clearing;
  });
  expect(result.current.pending?.lookupId).toBe(
    '33333333-3333-4333-8333-333333333333'
  );
});

it('bugfix: switching customer in a mixed sign-in state keeps the other user record', async () => {
  await AsyncStorage.clear();
  const keyA = pendingImeiStorageKey('merchant-1', 'customer-a');
  await AsyncStorage.setItem(
    keyA,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      lookupId: '11111111-1111-4111-8111-111111111111',
      tier: 'blacklist',
      ownerUserId: 'user-a',
    })
  );
  // user-b briefly paired with customer-a, then their own customer arrives.
  const { rerender } = renderHook(
    ({ customerId }: { customerId: string }) =>
      useImeiPendingLookup({
        userId: 'user-b',
        apiBaseUrl: 'https://test.invalid',
        customerId,
        merchantId: 'merchant-1',
      }),
    { initialProps: { customerId: 'customer-a' } }
  );
  await act(async () => undefined);
  await act(async () => {
    rerender({ customerId: 'customer-b' });
  });
  await expect(AsyncStorage.getItem(keyA)).resolves.not.toBeNull();
});

it('still drops the leaving user own record when they switch customer', async () => {
  await AsyncStorage.clear();
  const keyA = pendingImeiStorageKey('merchant-1', 'customer-a');
  await AsyncStorage.setItem(
    keyA,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      lookupId: '11111111-1111-4111-8111-111111111111',
      tier: 'blacklist',
      ownerUserId: 'user-a',
    })
  );
  mockPollImeiLookup.mockResolvedValue({ kind: 'retry', pollAfterMs: 60000 });
  const { rerender } = renderHook(
    ({ customerId }: { customerId: string }) =>
      useImeiPendingLookup({
        userId: 'user-a',
        apiBaseUrl: 'https://test.invalid',
        customerId,
        merchantId: 'merchant-1',
      }),
    { initialProps: { customerId: 'customer-a' } }
  );
  await act(async () => undefined);
  await act(async () => {
    rerender({ customerId: 'customer-b' });
  });
  await waitFor(async () =>
    expect(await AsyncStorage.getItem(keyA)).toBeNull()
  );
});
