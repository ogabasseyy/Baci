import { act, waitFor } from '@testing-library/react-native';
import { walletNumberRefreshTestFixture } from './use-wallet-number-refresh.test-support';
import { type WalletQueryData, walletKeys } from './wallet-query';

const { mockNumbers, mockHistory, key, cached, fresh, setup } =
  walletNumberRefreshTestFixture;
const readKinds = ['numeric', 'history'] as const;
beforeEach(walletNumberRefreshTestFixture.reset);

it('updates the shared cache without marking unchanged metadata as freshly loaded', async () => {
  const { result, client, request, cleanup } = setup();
  await act(async () => {
    await result.current.mutateAsync(request);
  });
  expect(client.getQueryData<WalletQueryData>(key)?.wallet.total_balance).toBe(
    300
  );
  expect(client.getQueryState(key)?.dataUpdatedAt).toBe(123);
  expect(request.refetchFull).not.toHaveBeenCalled();
  cleanup();
});

it.each(readKinds)('retains cache on %s and full errors', async (read) => {
  (read === 'numeric' ? mockNumbers : mockHistory).mockRejectedValue(
    new Error('Offline')
  );
  const { result, client, request, cleanup } = setup(read === 'history');
  request.refetchFull.mockRejectedValue(new Error('Offline'));
  await act(async () => {
    await expect(result.current.mutateAsync(request)).rejects.toThrow(
      'Offline'
    );
  });
  expect(client.getQueryData(key)).toEqual(cached);
  expect(request.refetchFull).toHaveBeenCalledTimes(1);
  cleanup();
});

it.each(readKinds)('skips %s fallback after disposal', async (read) => {
  let rejectRead!: (error: Error) => void;
  (read === 'numeric' ? mockNumbers : mockHistory).mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectRead = reject;
    })
  );
  const { result, client, request, cleanup } = setup(read === 'history');
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.mutateAsync(request);
  });
  request.isCurrent.mockReturnValue(false);

  await act(async () => {
    rejectRead(new Error('Could not refresh savings interest'));
    await expect(pending).resolves.toBeUndefined();
  });

  expect(request.refetchFull).not.toHaveBeenCalled();
  expect(client.getQueryData(key)).toEqual(cached);
  cleanup();
});

it.each(readKinds)('drops old %s data after switching', async (read) => {
  let complete!: (value: typeof fresh) => void;
  const deferred = new Promise<typeof fresh>((resolve) => {
    complete = resolve;
  });
  if (read === 'numeric') mockNumbers.mockReturnValue(deferred);
  else mockHistory.mockReturnValue(deferred.then(() => []));
  const { result, client, request, cleanup } = setup(read === 'history');
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.mutateAsync(request);
  });
  const nextKey = walletKeys.data({
    merchantId: 'merchant-1',
    ownerId: 'customer-2',
    userId: 'user-2',
  });
  const nextOwner = { ...cached, wallet: { ...cached.wallet, balance: 900 } };
  client.setQueryData(nextKey, nextOwner);
  request.isCurrent.mockReturnValue(false);
  await act(async () => {
    complete(fresh);
    await pending;
  });
  expect(client.getQueryData(key)).toEqual(cached);
  expect(client.getQueryData(nextKey)).toEqual(nextOwner);
  cleanup();
});

it('clears the realtime mutation error when a history failure recovers through a full read', async () => {
  mockHistory.mockRejectedValue(new Error('History unavailable'));
  const { result, client, request, cleanup } = setup(true);
  request.refetchFull.mockRejectedValueOnce(new Error('Full refresh failed'));
  await act(async () => {
    await expect(result.current.mutateAsync(request)).rejects.toThrow(
      'Full refresh failed'
    );
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(client.getQueryData(key)).toEqual(cached);
  const recovered = {
    ...cached,
    wallet: { ...cached.wallet, ...fresh.wallet },
  };
  request.refetchFull.mockImplementation(async () => {
    client.setQueryData(key, recovered);
  });
  await act(async () => {
    await expect(result.current.mutateAsync(request)).resolves.toBeUndefined();
  });
  await waitFor(() => {
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
  });
  expect(client.getQueryData(key)).toEqual(recovered);
  expect(request.refetchFull).toHaveBeenCalledTimes(2);
  cleanup();
});

it('waits for a pre-credit full snapshot then reads fresh numbers so older data cannot overwrite them', async () => {
  let complete!: (value: WalletQueryData) => void;
  const { result, client, request, cleanup } = setup();
  const full = client.fetchQuery({
    queryKey: key,
    queryFn: () =>
      new Promise<WalletQueryData>((resolve) => {
        complete = resolve;
      }),
  });
  request.refetchFull.mockImplementation(async () => {
    await full;
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.mutateAsync(request);
  });
  expect(mockNumbers).not.toHaveBeenCalled();
  await act(async () => {
    complete(cached);
    await pending;
  });
  expect(client.getQueryData<WalletQueryData>(key)?.wallet.total_balance).toBe(
    300
  );
  cleanup();
});

it('retries the numeric read when a newer full snapshot arrives during it', async () => {
  let complete!: (value: typeof fresh) => void;
  mockNumbers.mockReturnValueOnce(
    new Promise<typeof fresh>((resolve) => {
      complete = resolve;
    })
  );
  mockNumbers.mockResolvedValue({
    ...fresh,
    wallet: { ...fresh.wallet, balance: 200, total_balance: 400 },
  });
  const { result, client, request, cleanup } = setup();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.mutateAsync(request);
  });
  client.setQueryData(key, {
    ...cached,
    transactions: [
      {
        id: 'new',
        type: 'credit',
        amount: 200,
        description: 'New receipt',
        created_at: '2026-10-12',
      },
    ],
  });
  await act(async () => {
    complete(fresh);
    await pending;
  });
  expect(mockNumbers).toHaveBeenCalledTimes(2);
  expect(client.getQueryData<WalletQueryData>(key)?.wallet.total_balance).toBe(
    400
  );
  expect(client.getQueryData<WalletQueryData>(key)?.transactions[0].id).toBe(
    'new'
  );
  cleanup();
});

it('reloads full data when a newly added plan requires metadata', async () => {
  mockNumbers.mockResolvedValue({
    ...fresh,
    goals: [
      {
        id: 'new-goal',
        current_amount: 100,
        target_amount: 1000,
        status: 'active',
      },
    ],
  });
  const { result, client, request, cleanup } = setup();
  await act(async () => {
    await result.current.mutateAsync(request);
  });
  expect(request.refetchFull).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(key)).toEqual(cached);
  cleanup();
});

it('reloads pending account setup instead of keeping a missing account cached indefinitely', async () => {
  const { result, client, request, cleanup } = setup();
  client.setQueryData(key, {
    ...cached,
    wallet: { ...cached.wallet, funding_account: null },
  });
  await act(async () => {
    await result.current.mutateAsync(request);
  });
  expect(request.refetchFull).toHaveBeenCalledTimes(1);
  expect(mockNumbers).not.toHaveBeenCalled();
  cleanup();
});

it('honors an inactive metadata invalidation instead of replacing it with a numbers-only success', async () => {
  const { result, client, request, cleanup } = setup();
  await client.invalidateQueries({ queryKey: key, refetchType: 'none' });
  await act(async () => {
    await result.current.mutateAsync(request);
  });
  expect(request.refetchFull).toHaveBeenCalledTimes(1);
  expect(mockNumbers).not.toHaveBeenCalled();
  cleanup();
});
