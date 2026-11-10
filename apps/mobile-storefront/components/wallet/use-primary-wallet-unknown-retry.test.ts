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
  PRIMARY_UNKNOWN_RETRY_DELAY_MS,
  PRIMARY_UNKNOWN_RETRY_LIMIT,
  usePrimaryWalletUnknownRetry,
} from './use-primary-wallet-unknown-retry';

describe('usePrimaryWalletUnknownRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('re-checks a slow PiggyVest read a bounded number of times', () => {
    const refetch = jest.fn();
    renderHook(() =>
      usePrimaryWalletUnknownRetry({ unknown: true, scopeKey: 'a', refetch })
    );
    for (let i = 0; i < PRIMARY_UNKNOWN_RETRY_LIMIT + 2; i += 1) {
      act(() => {
        jest.advanceTimersByTime(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
      });
    }
    expect(refetch).toHaveBeenCalledTimes(PRIMARY_UNKNOWN_RETRY_LIMIT);
  });

  it('stops once the read answers and never runs for a known answer', () => {
    const refetch = jest.fn();
    const { rerender } = renderHook(
      ({ unknown }: { unknown: boolean }) =>
        usePrimaryWalletUnknownRetry({ unknown, scopeKey: 'a', refetch }),
      { initialProps: { unknown: true } }
    );
    act(() => {
      jest.advanceTimersByTime(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    rerender({ unknown: false });
    act(() => {
      jest.advanceTimersByTime(PRIMARY_UNKNOWN_RETRY_DELAY_MS * 5);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
