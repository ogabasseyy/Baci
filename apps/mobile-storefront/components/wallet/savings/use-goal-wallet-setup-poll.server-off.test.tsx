import { act, renderHook } from '@testing-library/react-native';
import { useGoalWalletSetupPoll } from './use-goal-wallet-setup-poll';

describe('server keeps PiggyVest off', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('never re-reads when the goal is not pending (no status, error, idle)', async () => {
    const reread = jest.fn();
    for (const phase of ['idle', 'error', 'unavailable'] as const) {
      renderHook(() =>
        useGoalWalletSetupPoll({ phase, scopeKey: 'a', reread })
      );
    }
    await act(async () => {
      await jest.advanceTimersByTimeAsync(120_000);
    });
    expect(reread).not.toHaveBeenCalled();
  });
});
