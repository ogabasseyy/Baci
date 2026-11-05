import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { act } from 'react';
import {
  PRIMARY_CREDIT_POLL_INTERVAL_MS,
  usePrimaryWalletCreditPoll,
} from './use-primary-wallet-credit-poll';

// Server off means the wallet screen passes enabled=false (no ready verdict):
// no polling, no alert, identical to production before PiggyVest.
describe('primary credit poll with the server off', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('never polls without a ready verdict, even with the fund panel open', () => {
    const refetch = jest.fn();
    renderHook(() =>
      usePrimaryWalletCreditPoll({
        balanceKobo: undefined,
        enabled: false,
        scopeKey: 'user-a',
        refetch,
      })
    );
    act(() => jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS * 5));
    expect(refetch).not.toHaveBeenCalled();
  });
});
