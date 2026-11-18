import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { usePiggyvestSlowdownStore } from '@/stores/piggyvest-slowdown-store';
import {
  PRIMARY_UNKNOWN_RETRY_DELAY_MS,
  PRIMARY_UNKNOWN_RETRY_LIMIT,
  usePrimaryWalletUnknownRetry,
} from './use-primary-wallet-unknown-retry';

// With PiggyVest off the wallet's answer is an authoritative not ready, never
// unknown, so the wallet never re-checks on its own.
describe('primary wallet unknown retry with the server off', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not refetch', () => {
    const refetch = jest.fn();
    renderHook(() =>
      usePrimaryWalletUnknownRetry({ unknown: false, scopeKey: 'a', refetch })
    );
    act(() => {
      jest.advanceTimersByTime(PRIMARY_UNKNOWN_RETRY_DELAY_MS * 5);
    });
    expect(refetch).not.toHaveBeenCalled();
  });

  it('raises no slowdown notice', () => {
    usePiggyvestSlowdownStore.setState({ signals: {} });
    renderHook(() =>
      usePrimaryWalletUnknownRetry({
        unknown: false,
        scopeKey: 'a',
        refetch: jest.fn(),
      })
    );
    expect(usePiggyvestSlowdownStore.getState().signals).toEqual({});
  });
});

describe('primary wallet unknown retry and the shared slowdown notice', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    usePiggyvestSlowdownStore.setState({ signals: {} });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports PiggyVest slow only after the quick re-checks fail', async () => {
    const refetch = jest.fn(async () => undefined);
    renderHook(() =>
      usePrimaryWalletUnknownRetry({ unknown: true, scopeKey: 'a', refetch })
    );
    expect(usePiggyvestSlowdownStore.getState().signals['wallet-read']).toBe(
      undefined
    );
    for (let attempt = 0; attempt < PRIMARY_UNKNOWN_RETRY_LIMIT; attempt += 1)
      await act(async () => {
        await jest.advanceTimersByTimeAsync(PRIMARY_UNKNOWN_RETRY_DELAY_MS);
      });
    expect(
      typeof usePiggyvestSlowdownStore.getState().signals['wallet-read']
    ).toBe('number');
  });
});
