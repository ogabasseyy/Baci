import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { WalletData } from '@/hooks/wallet-query';
import { PRIMARY_CREDIT_POLL_INTERVAL_MS } from './use-primary-wallet-credit-poll';
import { usePrimaryWalletWatch } from './use-primary-wallet-watch';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
// The unknown-answer retry has its own tests; isolate the credit poll here.
const mockUnknownRetry = jest.fn();
jest.mock('./use-primary-wallet-unknown-retry', () => ({
  usePrimaryWalletUnknownRetry: (input: unknown) => mockUnknownRetry(input),
}));

const base: WalletData = { balance: 900, loyalty_points: 0 };
type Props = {
  wallet: WalletData | undefined;
  scopeKey?: string;
  showFundPanel?: boolean;
};

function setup(initial: Props) {
  const refetch = jest.fn(async () => undefined);
  const hook = renderHook(
    (props: Props) =>
      usePrimaryWalletWatch({
        showFundPanel: true,
        scopeKey: 'user-a:m1',
        ...props,
        refetch,
      }),
    { initialProps: initial }
  );
  return { refetch, ...hook };
}

const ready: WalletData = { ...base, primary_balance_kobo: 500000 };
const unavailable: WalletData = { ...base, primary_unavailable: true };

describe('usePrimaryWalletWatch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the last ready balance and the poll through a transient failure', async () => {
    const { result, rerender, refetch } = setup({ wallet: ready });
    rerender({ wallet: unavailable });
    expect(result.current?.primary_balance_kobo).toBe(500000);
    // Kept, not fresh: marked so nothing treats it as current.
    expect(result.current?.primary_stale).toBe(true);
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS);
      });
    }
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('never marks a fresh balance as kept', () => {
    const { result } = setup({ wallet: ready });
    expect(result.current?.primary_stale).toBeUndefined();
  });

  it('re-checks on its own only while the PiggyVest answer is unknown', () => {
    const { rerender } = setup({ wallet: ready });
    expect(mockUnknownRetry).toHaveBeenLastCalledWith(
      expect.objectContaining({ unknown: false, scopeKey: 'user-a:m1' })
    );
    rerender({ wallet: unavailable });
    expect(mockUnknownRetry).toHaveBeenLastCalledWith(
      expect.objectContaining({ unknown: true, scopeKey: 'user-a:m1' })
    );
  });

  it('keeps re-checking while it shows a recalled balance', () => {
    const { result } = setup({ wallet: { ...ready, primary_stale: true } });
    expect(result.current?.primary_balance_kobo).toBe(
      ready.primary_balance_kobo
    );
    expect(mockUnknownRetry).toHaveBeenLastCalledWith(
      expect.objectContaining({ unknown: true })
    );
  });

  it('keeps the balance while the wallet has no data at all', () => {
    const { result, rerender } = setup({ wallet: ready });
    rerender({ wallet: undefined });
    expect(result.current).toBeUndefined();
    rerender({ wallet: unavailable });
    expect(result.current?.primary_balance_kobo).toBe(500000);
  });

  it('clears the balance and stops polling on an authoritative not-ready answer', () => {
    const { result, rerender, refetch } = setup({ wallet: ready });
    rerender({ wallet: base });
    expect(result.current?.primary_balance_kobo).toBeUndefined();
    act(() => {
      jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS * 2);
    });
    expect(refetch).not.toHaveBeenCalled();
  });

  it('drops the retained balance when the account or merchant changes', () => {
    const { result, rerender } = setup({ wallet: ready });
    rerender({ wallet: unavailable, scopeKey: 'user-b:m1' });
    expect(result.current?.primary_balance_kobo).toBeUndefined();
  });

  it('does not poll while the fund panel is closed', () => {
    const { refetch } = setup({ wallet: ready, showFundPanel: false });
    act(() => {
      jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS * 2);
    });
    expect(refetch).not.toHaveBeenCalled();
  });
});
