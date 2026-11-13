import { act, renderHook } from '@testing-library/react-native';
import { usePiggyvestSlowdownStore } from '@/stores/piggyvest-slowdown-store';
import { resetGoalSetupMemory } from './goal-setup-memory';
import {
  MAX_SLOW_ATTEMPTS,
  useGoalWalletSetupPoll,
} from './use-goal-wallet-setup-poll';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

type Props = {
  phase: SavingsPlanFundingPhase;
  scope?: string;
  pendingSince?: number | null;
  readsPaused?: boolean;
};

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
        pendingSince: props.pendingSince,
        readsPaused: props.readsPaused,
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

beforeEach(() => {
  usePiggyvestSlowdownStore.setState({ signals: {} });
  jest.useFakeTimers();
  resetGoalSetupMemory();
});
afterEach(() => jest.useRealTimers());

describe('useGoalWalletSetupPoll', () => {
  it('reports slow after 12 pending reads, and Check again reads now and polls afresh while staying slow', async () => {
    const { result, reread } = setup({ phase: 'pending' });
    expect(result.current.slow).toBe(false);
    await ticks(12);
    expect(reread).toHaveBeenCalledTimes(12);
    expect(result.current.slow).toBe(true);
    await act(async () => result.current.checkAgain());
    expect(reread).toHaveBeenCalledTimes(13);
    expect(reread).toHaveBeenLastCalledWith({ silent: true });
    // A minute has passed: the "about a minute" promise never comes back.
    expect(result.current.slow).toBe(true);
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
    expect(result.current.paused).toBe(true);
    await act(async () => result.current.checkAgain());
    expect(reread).toHaveBeenCalledTimes(calls + 1);
    expect(result.current.paused).toBe(false);
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

  describe('bugfix: one failed read at the end of the first minute turned the plan into an error', () => {
    it('does not escalate a single blip on the last quick read', async () => {
      const onExhausted = jest.fn();
      let call = 0;
      const reread = jest.fn(() => {
        call += 1;
        return call === 12
          ? Promise.reject(new Error('blip'))
          : Promise.resolve(undefined);
      });
      renderHook(() =>
        useGoalWalletSetupPoll({
          phase: 'pending',
          scopeKey: 'a',
          reread,
          onExhausted,
        })
      );
      await ticks(12);
      expect(reread).toHaveBeenCalledTimes(12);
      expect(onExhausted).not.toHaveBeenCalled();
    });
  });

  describe('bugfix: reopening the sheet brought back "about a minute" forever', () => {
    it('stays slow after a remount once a minute has passed since it was first seen waiting', async () => {
      const first = setup({ phase: 'pending' });
      await advance(30_000);
      first.unmount();
      await advance(31_000);
      const { result } = setup({ phase: 'pending' });
      await advance(0);
      expect(result.current.slow).toBe(true);
    });

    it('turns slow a minute in even when each sheet visit is short', async () => {
      const first = setup({ phase: 'pending' });
      await advance(20_000);
      first.unmount();
      const { result } = setup({ phase: 'pending' });
      await advance(20_000);
      expect(result.current.slow).toBe(false);
      await advance(20_000);
      expect(result.current.slow).toBe(true);
    });

    it('bugfix: a plan pending for hours is slow on the very first open', async () => {
      const { result } = setup({
        phase: 'pending',
        pendingSince: Date.now() - 3 * 60 * 60 * 1000,
      });
      await advance(0);
      expect(result.current.slow).toBe(true);
    });

    it('bugfix: a setup started long after the plan gets its own first minute', async () => {
      const view = setup({
        phase: 'not_started',
        pendingSince: Date.now() - 3 * 60 * 60 * 1000,
      });
      await advance(0);
      view.rerender({
        phase: 'pending',
        pendingSince: Date.now() - 3 * 60 * 60 * 1000,
      });
      await advance(0);
      expect(view.result.current.slow).toBe(false);
      await advance(61_000);
      expect(view.result.current.slow).toBe(true);
    });

    it('counts the first minute from when the plan was created', async () => {
      const { result } = setup({
        phase: 'pending',
        pendingSince: Date.now() - 50_000,
      });
      await advance(5_000);
      expect(result.current.slow).toBe(false);
      await advance(5_000);
      expect(result.current.slow).toBe(true);
    });

    it('turns a stalled setup slow after a minute too', async () => {
      const { result } = setup({ phase: 'setup_retryable' });
      expect(result.current.slow).toBe(false);
      await advance(60_000);
      expect(result.current.slow).toBe(true);
    });

    it('gives a second stall its own first minute after the plan was ready', async () => {
      const view = setup({ phase: 'pending' });
      await advance(61_000);
      expect(view.result.current.slow).toBe(true);
      view.rerender({ phase: 'ready' });
      await advance(0);
      view.rerender({ phase: 'pending' });
      await advance(0);
      expect(view.result.current.slow).toBe(false);
    });

    it('is not slow once the plan is ready', async () => {
      const view = setup({ phase: 'pending' });
      await advance(61_000);
      view.rerender({ phase: 'ready' });
      expect(view.result.current.slow).toBe(false);
    });
  });

  describe('bugfix: the slow notice reached the sheet 10-30 s after it opened', () => {
    const HOURS = 3 * 60 * 60 * 1000;

    it('raises the shared notice at once from what is known, with reads paused', async () => {
      const { reread } = setup({
        phase: 'pending',
        pendingSince: Date.now() - HOURS,
        readsPaused: true,
      });
      await advance(0);
      expect(
        Object.keys(usePiggyvestSlowdownStore.getState().signals)
      ).toContain('goal-setup');
      await advance(60_000);
      expect(reread).not.toHaveBeenCalled();
    });

    it('never clears another screen’s notice while its reads are paused', async () => {
      act(() => usePiggyvestSlowdownStore.getState().markSlow('goal-setup'));
      setup({ phase: 'pending', pendingSince: Date.now(), readsPaused: true });
      await advance(0);
      expect(
        Object.keys(usePiggyvestSlowdownStore.getState().signals)
      ).toContain('goal-setup');
    });
  });
});
