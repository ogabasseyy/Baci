import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import {
  announceLatePrimaryAnswer,
  forgetRememberedPrimaryFundingAccounts,
} from '@/hooks/primary-funding-account-memory';
import {
  PRIMARY_UNKNOWN_RETRY_DELAY_MS,
  PRIMARY_UNKNOWN_RETRY_LIMIT,
  PRIMARY_UNKNOWN_SLOW_RETRY_DELAY_MS,
  PRIMARY_UNKNOWN_SLOW_RETRY_LIMIT,
  usePrimaryWalletUnknownRetry,
} from './use-primary-wallet-unknown-retry';

async function tick(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('usePrimaryWalletUnknownRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    forgetRememberedPrimaryFundingAccounts();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('re-checks a slow PiggyVest read a bounded number of times', async () => {
    const refetch = jest.fn(async () => undefined);
    renderHook(() =>
      usePrimaryWalletUnknownRetry({ unknown: true, scopeKey: 'u:m', refetch })
    );
    for (let i = 0; i < PRIMARY_UNKNOWN_RETRY_LIMIT + 2; i += 1) {
      await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    }
    expect(refetch).toHaveBeenCalledTimes(PRIMARY_UNKNOWN_RETRY_LIMIT);
    // Still unknown (or recalled): keep re-checking, slowly.
    await tick(PRIMARY_UNKNOWN_SLOW_RETRY_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(PRIMARY_UNKNOWN_RETRY_LIMIT + 1);
    // The slow phase is bounded too: no endless polling on a mounted screen.
    for (let i = 0; i < PRIMARY_UNKNOWN_SLOW_RETRY_LIMIT + 3; i += 1) {
      await tick(PRIMARY_UNKNOWN_SLOW_RETRY_DELAY_MS);
    }
    expect(refetch).toHaveBeenCalledTimes(
      PRIMARY_UNKNOWN_RETRY_LIMIT + PRIMARY_UNKNOWN_SLOW_RETRY_LIMIT
    );
  });

  it('bounds reloads from late answers by the quick attempts', async () => {
    const refetch = jest.fn(async () => undefined);
    renderHook(() =>
      usePrimaryWalletUnknownRetry({ unknown: true, scopeKey: 'u:m', refetch })
    );
    // A provider that always answers late announces after every reload.
    for (let i = 0; i < PRIMARY_UNKNOWN_RETRY_LIMIT + 5; i += 1) {
      await act(async () => {
        announceLatePrimaryAnswer('m', 'u');
      });
    }
    expect(refetch).toHaveBeenCalledTimes(PRIMARY_UNKNOWN_RETRY_LIMIT);
  });

  it('keeps re-checking after a reload fails, without an unhandled error', async () => {
    const refetch = jest.fn(async () => {
      throw new Error('offline');
    });
    renderHook(() =>
      usePrimaryWalletUnknownRetry({ unknown: true, scopeKey: 'u:m', refetch })
    );
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('waits for a reload to finish before spending the next attempt', async () => {
    let finish: () => void = () => undefined;
    const refetch = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    renderHook(() =>
      usePrimaryWalletUnknownRetry({ unknown: true, scopeKey: 'u:m', refetch })
    );
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(1);
    // The reload is still running: no overlapping second reload.
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS * 3);
    expect(refetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('never starts a second reload while one is running', async () => {
    let finish: () => void = () => undefined;
    const refetch = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    renderHook(() =>
      usePrimaryWalletUnknownRetry({ unknown: true, scopeKey: 'u:m', refetch })
    );
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => {
      announceLatePrimaryAnswer('m', 'u');
      announceLatePrimaryAnswer('m', 'u');
    });
    // Never two reloads at once.
    expect(refetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a late answer for another account or merchant', async () => {
    const refetch = jest.fn(async () => undefined);
    renderHook(() =>
      usePrimaryWalletUnknownRetry({ unknown: true, scopeKey: 'u:m', refetch })
    );
    act(() => {
      announceLatePrimaryAnswer('m', 'other-user');
      announceLatePrimaryAnswer('other-merchant', 'u');
    });
    expect(refetch).not.toHaveBeenCalled();
  });

  it('reloads as soon as a late confirmed answer lands', async () => {
    const refetch = jest.fn(async () => undefined);
    renderHook(() =>
      usePrimaryWalletUnknownRetry({ unknown: true, scopeKey: 'u:m', refetch })
    );
    act(() => {
      announceLatePrimaryAnswer('m', 'u');
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('stops once the read answers and ignores late answers then', async () => {
    const refetch = jest.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ unknown }: { unknown: boolean }) =>
        usePrimaryWalletUnknownRetry({ unknown, scopeKey: 'u:m', refetch }),
      { initialProps: { unknown: true } }
    );
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(1);
    rerender({ unknown: false });
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS * 5);
    act(() => {
      announceLatePrimaryAnswer('m', 'u');
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('re-arms for a new account once an older reload finishes', async () => {
    let finish: () => void = () => undefined;
    const refetch = jest
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) =>
        usePrimaryWalletUnknownRetry({ unknown: true, scopeKey, refetch }),
      { initialProps: { scopeKey: 'u:m' } }
    );
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(1);
    rerender({ scopeKey: 'v:m' });
    // Account b waits while a's reload is still running.
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS * 2);
    expect(refetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('restarts the wait when the signed-in account changes', async () => {
    const refetch = jest.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) =>
        usePrimaryWalletUnknownRetry({ unknown: true, scopeKey, refetch }),
      { initialProps: { scopeKey: 'u:m' } }
    );
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS - 1000);
    rerender({ scopeKey: 'v:m' });
    // The old scope's timer is gone; the new one waits a full delay.
    await tick(1000);
    expect(refetch).not.toHaveBeenCalled();
    await tick(PRIMARY_UNKNOWN_RETRY_DELAY_MS - 1000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
