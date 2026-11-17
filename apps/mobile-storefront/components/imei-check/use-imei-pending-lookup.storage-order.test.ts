import { expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/imei-poll-client', () => ({
  pollImeiLookup: jest.fn(),
}));

import { pendingImeiStorageKey } from '@/lib/imei-pending-storage';
import { pollImeiLookup } from '@/lib/imei-poll-client';
import { useImeiPendingLookup } from './use-imei-pending-lookup';

const mockPollImeiLookup = jest.mocked(pollImeiLookup);

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
  const realRemove = AsyncStorage.removeItem.bind(AsyncStorage);
  // The removal really deletes the record, just late (the race in review).
  const removeSpy = jest.spyOn(AsyncStorage, 'removeItem');
  const removalsBefore = removeSpy.mock.calls.length;
  removeSpy.mockImplementationOnce(
    (key: string) =>
      new Promise<void>((done) => {
        finishRemove = () => {
          void realRemove(key).then(() => done());
        };
      })
  );
  let clearing!: Promise<void>;
  act(() => {
    clearing = result.current.clear();
  });
  let starting!: Promise<void>;
  act(() => {
    starting = result.current.start({
      lookupId: '33333333-3333-4333-8333-333333333333',
      pollAfterMs: 0,
      tier: 'blacklist',
    });
  });
  // Wait for this test's own removal, not an earlier test's call.
  await waitFor(() =>
    expect(removeSpy.mock.calls.length).toBeGreaterThan(removalsBefore)
  );
  await act(async () => {
    finishRemove();
    await clearing;
    await starting;
  });
  expect(result.current.pending?.lookupId).toBe(
    '33333333-3333-4333-8333-333333333333'
  );
  // The newer check's saved record survives, so it can still be resumed.
  expect(
    JSON.parse(
      (await AsyncStorage.getItem(
        pendingImeiStorageKey('merchant-1', 'customer-1')
      )) ?? 'null'
    )
  ).toMatchObject({ lookupId: '33333333-3333-4333-8333-333333333333' });
  expect(result.current.canResume).toBe(true);
  await waitFor(() =>
    expect(mockPollImeiLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupId: '33333333-3333-4333-8333-333333333333',
      })
    )
  );
});

it('bugfix: a slow removal of a corrupt saved record cannot delete a newer check', async () => {
  await AsyncStorage.clear();
  const key = pendingImeiStorageKey('merchant-1', 'customer-1');
  await AsyncStorage.setItem(key, '{not json');
  const realRemove = AsyncStorage.removeItem.bind(AsyncStorage);
  let finishRemove!: () => void;
  const removeSpy = jest.spyOn(AsyncStorage, 'removeItem');
  const removalsBefore = removeSpy.mock.calls.length;
  removeSpy.mockImplementationOnce(
    (k: string) =>
      new Promise<void>((done) => {
        finishRemove = () => {
          void realRemove(k).then(() => done());
        };
      })
  );
  mockPollImeiLookup.mockResolvedValue({ kind: 'retry', pollAfterMs: 60000 });
  const { result } = renderHook(() =>
    useImeiPendingLookup({
      accessToken: 'token',
      userId: 'user-a',
      apiBaseUrl: 'https://test.invalid',
      customerId: 'customer-1',
      merchantId: 'merchant-1',
    })
  );
  // The restore is now removing the corrupt record, slowly.
  // Wait for this test's own removal, not an earlier test's call.
  await waitFor(() =>
    expect(removeSpy.mock.calls.length).toBeGreaterThan(removalsBefore)
  );
  let starting!: Promise<void>;
  act(() => {
    starting = result.current.start({
      lookupId: '44444444-4444-4444-8444-444444444444',
      pollAfterMs: 60000,
      tier: 'blacklist',
    });
  });
  // Let the new save run while the corrupt record's removal is still slow.
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
  await act(async () => {
    finishRemove();
    await starting;
  });
  expect(JSON.parse((await AsyncStorage.getItem(key)) ?? 'null')).toMatchObject(
    { lookupId: '44444444-4444-4444-8444-444444444444' }
  );
  expect(result.current.canResume).toBe(true);
});
