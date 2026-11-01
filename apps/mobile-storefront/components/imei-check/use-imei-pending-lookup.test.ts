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
      })
    );
    mockPollImeiLookup.mockResolvedValue({
      kind: 'pending',
      pollAfterMs: 5000,
    });
    const { result } = renderHook(() =>
      useImeiPendingLookup({
        accessToken: 'token',
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

it('passes a restored recovery identity to the terminal result', async () => {
  await AsyncStorage.clear();
  const recovery = {
    storageKey: `imei-attempt-v1-${'a'.repeat(64)}`,
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  };
  await AsyncStorage.setItem(
    pendingImeiStorageKey('merchant-1', 'customer-1'),
    JSON.stringify({
      createdAt: new Date().toISOString(),
      lookupId: '22222222-2222-4222-8222-222222222222',
      tier: 'blacklist',
      recovery,
    })
  );
  mockPollImeiLookup.mockResolvedValue({
    kind: 'complete',
    result: {
      imei: '490154203237518',
      device: 'iPhone',
      modelNumber: '',
      status: 'Clean',
      icloud: 'Unknown',
      icloudLock: 'Unknown',
      simLock: 'Unknown',
      blacklistStatus: 'Clean',
      carrier: 'Unknown',
      deviceImage: '',
      score: 50,
      deviceType: 'apple',
      verdict: 'Safe',
      verdictType: 'safe',
    },
  });
  const { result } = renderHook(() =>
    useImeiPendingLookup({
      apiBaseUrl: 'https://test.invalid',
      merchantId: 'merchant-1',
      customerId: 'customer-1',
    })
  );
  await waitFor(() => expect(result.current.terminal?.kind).toBe('complete'));
  expect(result.current.terminal).toMatchObject({ recovery });
});
