import { act, renderHook } from '@testing-library/react-native';
import { useGoalWalletSetupPoll } from './use-goal-wallet-setup-poll';
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
  it('re-reads a pending goal every 5 seconds, at most 12 times', async () => {
    const { reread } = setup({ phase: 'pending' });
    await advance(4999);
    expect(reread).not.toHaveBeenCalled();
    await advance(1);
    expect(reread).toHaveBeenCalledTimes(1);
    expect(reread).toHaveBeenCalledWith({ silent: true });
    await ticks(30);
    expect(reread).toHaveBeenCalledTimes(12);
  });

  it('keeps polling, without throwing, when a read rejects', async () => {
    const reread = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(undefined);
    setup({ phase: 'pending' }, reread);
    await ticks(3);
    expect(reread).toHaveBeenCalledTimes(3);
    await ticks(30);
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
});
