import { act, renderHook } from '@testing-library/react-native';
import { usePiggyvestSlowdownStore } from '@/stores/piggyvest-slowdown-store';
import {
  MAX_SLOW_ATTEMPTS,
  useGoalWalletSetupPoll,
} from './use-goal-wallet-setup-poll';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

type Props = { phase: SavingsPlanFundingPhase; scope?: string };

function setup(
  initial: Props,
  reread = jest.fn().mockResolvedValue(undefined)
) {
  const hook = renderHook(
    (props: Props) =>
      useGoalWalletSetupPoll({
        phase: props.phase,
        scopeKey: props.scope ?? 'a',
        reread,
      }),
    { initialProps: initial }
  );
  return { ...hook, reread };
}
const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

// One act per interval: React applies each attempt's state update, and so
// schedules the next timer, only when its act scope ends.
const ticks = async (count: number) => {
  for (let tick = 0; tick < count; tick += 1) await advance(5000);
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useGoalWalletSetupPoll', () => {
  it('reports slow after 12 pending reads, and Check again reads now and polls afresh', async () => {
    const { result, reread } = setup({ phase: 'pending' });
    expect(result.current.slow).toBe(false);
    await ticks(12);
    expect(reread).toHaveBeenCalledTimes(12);
    expect(result.current.slow).toBe(true);
    await act(async () => result.current.checkAgain());
    expect(reread).toHaveBeenCalledTimes(13);
    expect(reread).toHaveBeenLastCalledWith({ silent: true });
    expect(result.current.slow).toBe(false);
    await ticks(1);
    expect(reread).toHaveBeenCalledTimes(14);
  });

  it('re-reads a pending goal every 5 seconds for the first minute', async () => {
    const { reread } = setup({ phase: 'pending' });
    await advance(4999);
    expect(reread).not.toHaveBeenCalled();
    await advance(1);
    expect(reread).toHaveBeenCalledTimes(1);
    expect(reread).toHaveBeenCalledWith({ silent: true });
    await ticks(11);
    expect(reread).toHaveBeenCalledTimes(12);
  });

  describe('bugfix: setup checks stopped after a minute, leaving a dead end', () => {
    it('keeps checking every 20 seconds after the first minute', async () => {
      const { reread } = setup({ phase: 'pending' });
      await ticks(12);
      expect(reread).toHaveBeenCalledTimes(12);
      await advance(19_999);
      expect(reread).toHaveBeenCalledTimes(12);
      await advance(1);
      expect(reread).toHaveBeenCalledTimes(13);
      for (let tick = 0; tick < 10; tick += 1) await advance(20_000);
      expect(reread).toHaveBeenCalledTimes(23);
    });
  });

  it('keeps polling, without throwing, when a read rejects', async () => {
    const reread = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(undefined);
    setup({ phase: 'pending' }, reread);
    await ticks(3);
    expect(reread).toHaveBeenCalledTimes(3);
    await ticks(9);
    expect(reread).toHaveBeenCalledTimes(12);
  });

  it.each([
    'idle',
    'loading',
    'ready',
    'not_started',
    'setup_retryable',
    'unavailable',
    'error',
  ] as const)('does not poll while the phase is %s', async (phase) => {
    const { reread } = setup({ phase });
    await advance(60_000);
    expect(reread).not.toHaveBeenCalled();
  });

  it('stops as soon as the goal is ready', async () => {
    const { reread, rerender } = setup({ phase: 'pending' });
    await advance(5000);
    rerender({ phase: 'ready' });
    await advance(60_000);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('stops on unmount', async () => {
    const { reread, unmount } = setup({ phase: 'pending' });
    await advance(5000);
    unmount();
    await advance(60_000);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('starts over for another account or goal', async () => {
    const { reread, rerender } = setup({ phase: 'pending' });
    await ticks(12);
    expect(reread).toHaveBeenCalledTimes(12);
    rerender({ phase: 'pending', scope: 'b' });
    await advance(5000);
    expect(reread).toHaveBeenCalledTimes(13);
  });

  it('pauses after about an hour of slow checks, and Check now resumes', async () => {
    const { result, reread } = setup({ phase: 'pending' });
    await ticks(12);
    for (let tick = 0; tick < MAX_SLOW_ATTEMPTS; tick += 1)
      await advance(20_000);
    const calls = reread.mock.calls.length;
    expect(calls).toBe(12 + MAX_SLOW_ATTEMPTS);
    await advance(120_000);
    expect(reread).toHaveBeenCalledTimes(calls);
    expect(result.current.slow).toBe(true);
    await act(async () => result.current.checkAgain());
    expect(reread).toHaveBeenCalledTimes(calls + 1);
  });

  describe('bugfix: checks stopped after a failed read during a slowdown', () => {
    afterEach(() => usePiggyvestSlowdownStore.setState({ signals: {} }));

    it('keeps checking an errored read while PiggyVest is slow', async () => {
      act(() => usePiggyvestSlowdownStore.getState().markSlow('wallet-read'));
      const { reread } = setup({ phase: 'error' });
      await ticks(2);
      expect(reread).toHaveBeenCalledTimes(2);
    });

    it('never raises the slowdown signal from an errored read', async () => {
      act(() => usePiggyvestSlowdownStore.getState().markSlow('wallet-read'));
      const { result, reread } = setup({ phase: 'error' });
      await ticks(12);
      expect(reread).toHaveBeenCalledTimes(12);
      expect(result.current.slow).toBe(true);
      // Only a pending setup reports itself slow: no self-latching.
      expect(
        usePiggyvestSlowdownStore.getState().signals['goal-setup']
      ).toBeUndefined();
    });

    it('does not poll an errored read when PiggyVest is not slow', async () => {
      const { reread } = setup({ phase: 'error' });
      await ticks(2);
      expect(reread).not.toHaveBeenCalled();
    });
  });

  describe('bugfix: checks stopped when the last quick read failed', () => {
    it('keeps checking after reporting its own failed read', async () => {
      const onExhausted = jest.fn();
      const reread = jest.fn().mockRejectedValue(new Error('down'));
      const hook = renderHook(
        (props: Props) =>
          useGoalWalletSetupPoll({
            phase: props.phase,
            scopeKey: 'a',
            reread,
            onExhausted,
          }),
        { initialProps: { phase: 'pending' } as Props }
      );
      await ticks(12);
      expect(onExhausted).toHaveBeenCalledTimes(1);
      // The parent flips the phase to error; the poll keeps going.
      hook.rerender({ phase: 'error' });
      await advance(20_000);
      expect(reread).toHaveBeenCalledTimes(13);
    });
  });
});
