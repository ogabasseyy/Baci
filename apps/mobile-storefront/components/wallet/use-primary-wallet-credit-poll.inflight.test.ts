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
  PRIMARY_CREDIT_POLL_INTERVAL_MS,
  usePrimaryWalletCreditPoll,
} from './use-primary-wallet-credit-poll';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('./savings/notify-savings', () => ({ notifySavings: jest.fn() }));

describe('usePrimaryWalletCreditPoll with a slow refresh', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('never overlaps refetches and lets a slow load finish', async () => {
    let finish: () => void = () => undefined;
    const refetch = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    renderHook(() =>
      usePrimaryWalletCreditPoll({
        balanceKobo: 5000,
        enabled: true,
        scopeKey: 'u:m',
        refetch,
      })
    );
    // Three ticks while the first refresh is still running: one call only.
    act(() => {
      jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS * 3);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    // The slow refresh completes; the next tick starts a new one.
    await act(async () => {
      finish();
    });
    act(() => {
      jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS);
    });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('keeps polling after a failed refresh', async () => {
    const refetch = jest.fn(async () => {
      throw new Error('offline');
    });
    renderHook(() =>
      usePrimaryWalletCreditPoll({
        balanceKobo: 5000,
        enabled: true,
        scopeKey: 'u:m',
        refetch,
      })
    );
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS);
      });
    }
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
