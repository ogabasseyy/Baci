import { act, waitFor } from '@testing-library/react-native';
import { walletNumberRefreshTestFixture as fixture } from './use-wallet-number-refresh.test-support';
import { WALLET_LOAD_TIMEOUT_MS } from './wallet-load-deadline';

beforeEach(() => {
  jest.useFakeTimers();
  fixture.reset();
});
afterEach(() => jest.useRealTimers());

it.each([
  'numbers',
  'history',
] as const)('bounds stalled %s, preserves cache and permits a successful retry', async (kind) => {
  const read = kind === 'numbers' ? fixture.mockNumbers : fixture.mockHistory;
  let finishLate!: (value: unknown) => void;
  read.mockReturnValueOnce(
    new Promise((resolve) => {
      finishLate = resolve;
    })
  );
  const { result, client, request, cleanup } = fixture.setup(true);
  request.refetchFull.mockRejectedValueOnce(new Error('Fallback unavailable'));
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.mutateAsync(request);
  });
  const rejected = expect(pending).rejects.toThrow('Fallback unavailable');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(WALLET_LOAD_TIMEOUT_MS);
    await rejected;
  });
  expect(request.refetchFull).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(fixture.key)).toEqual(fixture.cached);
  await waitFor(() => expect(result.current.isError).toBe(true));

  await act(async () => {
    await result.current.mutateAsync(request);
    finishLate(
      kind === 'numbers'
        ? {
            ...fixture.fresh,
            wallet: { ...fixture.fresh.wallet, total_balance: 999 },
          }
        : [{ id: 'late-stale-transaction' }]
    );
  });
  await waitFor(() => expect(result.current.isError).toBe(false));
  expect(client.getQueryData(fixture.key)).toMatchObject({
    wallet: { total_balance: 300 },
  });
  cleanup();
});

it('also bounds a stalled full-read fallback instead of holding the refresh queue', async () => {
  fixture.mockNumbers.mockRejectedValue(new Error('Offline'));
  const { result, request, cleanup } = fixture.setup();
  request.refetchFull.mockReturnValueOnce(new Promise(() => {}));
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.mutateAsync(request);
  });
  const rejected = expect(pending).rejects.toThrow('Wallet load timed out');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(WALLET_LOAD_TIMEOUT_MS);
    await rejected;
  });
  await waitFor(() => expect(result.current.isPending).toBe(false));
  cleanup();
});
