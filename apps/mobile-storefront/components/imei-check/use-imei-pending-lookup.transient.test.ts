import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { pendingImeiStorageKey } from '@/lib/imei-pending-storage';
import { useImeiPendingLookup } from './use-imei-pending-lookup';

// The real poll client: only the network is faked.
const LOOKUP_ID = '11111111-1111-4111-8111-111111111111';
const request = {
  key: '22222222-2222-4222-8222-222222222222',
  purchase: 'imei-credit|user-1||smartphone|blacklist|abc',
};
const storageKey = pendingImeiStorageKey('merchant-1', 'customer-1');

beforeEach(async () => {
  await AsyncStorage.clear();
  global.fetch = jest.fn(async () => ({
    json: async () => ({
      success: false,
      status: 'error',
      code: 'LOOKUP_READ_FAILED',
      error: 'Unable to read lookup',
    }),
    ok: false,
    status: 500,
  })) as unknown as typeof fetch;
});

describe('bugfix: a transient poll failure retired a paid lookup and its key', () => {
  it('keeps the pending record and its saved key after LOOKUP_READ_FAILED', async () => {
    const { result } = renderHook(() =>
      useImeiPendingLookup({
        accessToken: 'token',
        apiBaseUrl: 'https://shop.example.com',
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        userId: 'user-1',
      })
    );

    await act(async () => {
      await result.current.start({
        lookupId: LOOKUP_ID,
        pollAfterMs: 0,
        tier: 'blacklist',
        device: 'smartphone',
        request,
      });
    });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.pending?.pollAfterMs).toBe(10_000)
    );

    expect(result.current.terminal).toBeNull();
    expect(result.current.pending?.lookupId).toBe(LOOKUP_ID);
    const saved = JSON.parse((await AsyncStorage.getItem(storageKey)) ?? '{}');
    expect(saved).toMatchObject({ lookupId: LOOKUP_ID, request });
  });
});
