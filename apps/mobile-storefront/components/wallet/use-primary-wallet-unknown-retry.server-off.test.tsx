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
});
