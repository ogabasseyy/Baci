import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import {
  PRIMARY_CREDIT_POLL_INTERVAL_MS,
  PRIMARY_CREDIT_POLL_MAX_MS,
  usePrimaryWalletCreditPoll,
} from './use-primary-wallet-credit-poll';

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

type Props = {
  balanceKobo: number | null | undefined;
  enabled: boolean;
  scopeKey: string;
};

function setup(initial: Props) {
  const refetch = jest.fn(async () => undefined);
  const hook = renderHook(
    (props: Props) => usePrimaryWalletCreditPoll({ ...props, refetch }),
    { initialProps: initial }
  );
  return { refetch, ...hook };
}

// Each refresh settles between ticks, as a real wallet load does.
async function tick(times: number) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS);
    });
  }
}

const open: Props = { balanceKobo: 5000, enabled: true, scopeKey: 'user-a' };

describe('usePrimaryWalletCreditPoll', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    alertSpy.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('refetches every 10 seconds while the fund panel is open', async () => {
    const { refetch } = setup(open);
    expect(refetch).not.toHaveBeenCalled();
    await tick(3);
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it('stops after five minutes', async () => {
    const { refetch } = setup(open);
    await tick(PRIMARY_CREDIT_POLL_MAX_MS / PRIMARY_CREDIT_POLL_INTERVAL_MS);
    const callsAtLimit = refetch.mock.calls.length;
    expect(callsAtLimit).toBeGreaterThanOrEqual(29);
    expect(callsAtLimit).toBeLessThanOrEqual(30);
    await tick(PRIMARY_CREDIT_POLL_MAX_MS / PRIMARY_CREDIT_POLL_INTERVAL_MS);
    expect(refetch).toHaveBeenCalledTimes(callsAtLimit);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('does not poll when disabled (panel closed or legacy wallet)', () => {
    const { refetch } = setup({ ...open, enabled: false });
    act(() => jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS * 3));
    expect(refetch).not.toHaveBeenCalled();
  });

  it('stops when the panel closes and on unmount', () => {
    const { refetch, rerender, unmount } = setup(open);
    act(() => jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS));
    rerender({ ...open, enabled: false });
    act(() => jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS * 3));
    expect(refetch).toHaveBeenCalledTimes(1);
    rerender(open);
    unmount();
    act(() => jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS * 3));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('alerts once and stops when the balance rises above the value at open', () => {
    const { refetch, rerender } = setup(open);
    act(() => jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS));
    rerender({ ...open, balanceKobo: 9000 });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      'Money received',
      'Your wallet balance has been updated.'
    );
    rerender({ ...open, balanceKobo: 12000 });
    act(() => jest.advanceTimersByTime(PRIMARY_CREDIT_POLL_INTERVAL_MS * 3));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('bugfix: announces the first balance on a pending account opened with none', () => {
    // Arrange: the sheet opened on a pending PiggyVest account (no balance).
    const { rerender } = setup({ ...open, balanceKobo: null });

    // Act: a transfer makes the balance available.
    rerender({ ...open, balanceKobo: 5000 });

    // Assert
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('does not alert when the balance falls or stays the same', () => {
    const { rerender } = setup(open);
    rerender({ ...open, balanceKobo: 5000 });
    rerender({ ...open, balanceKobo: 1000 });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('restarts with a fresh baseline when the account switches', () => {
    const { rerender } = setup(open);
    rerender({ balanceKobo: 20000, enabled: true, scopeKey: 'user-b' });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('keeps polling through a failed refetch', async () => {
    const refetch = jest.fn(async () => {
      throw new Error('offline');
    });
    renderHook(() => usePrimaryWalletCreditPoll({ ...open, refetch }));
    await tick(2);
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
