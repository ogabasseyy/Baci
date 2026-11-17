import { renderHook } from '@testing-library/react-native';
import {
  pendingWalletHeadStart,
  rememberWalletHeadStart,
} from './pending-wallet-head-start';
import { useAutoWalletHeadStart } from './use-auto-wallet-head-start';

type Props = { ready: boolean; busy: boolean; addAmount: string };

function setup(goalId: string, initial: Props) {
  const onAddSavings = jest.fn();
  const view = renderHook(
    (props: Props) =>
      useAutoWalletHeadStart({ goalId, onAddSavings, ...props }),
    { initialProps: initial }
  );
  return { onAddSavings, ...view };
}

describe('useAutoWalletHeadStart with PiggyVest off', () => {
  it('waits for the plan to be ready, then starts the transfer exactly once', () => {
    rememberWalletHeadStart('goal-1', 100);
    const { onAddSavings, result, rerender } = setup('goal-1', {
      ready: false,
      busy: false,
      addAmount: '100',
    });
    expect(result.current).toBe(100);
    expect(onAddSavings).not.toHaveBeenCalled();
    rerender({ ready: true, busy: false, addAmount: '100' });
    expect(onAddSavings).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
    rerender({ ready: true, busy: false, addAmount: '100' });
    expect(onAddSavings).toHaveBeenCalledTimes(1);
  });

  it('holds off while another add is already in flight', () => {
    rememberWalletHeadStart('goal-2', 100);
    const { onAddSavings, rerender } = setup('goal-2', {
      ready: true,
      busy: true,
      addAmount: '100',
    });
    expect(onAddSavings).not.toHaveBeenCalled();
    rerender({ ready: true, busy: false, addAmount: '100' });
    expect(onAddSavings).toHaveBeenCalledTimes(1);
  });

  it('never moves a different amount than the head start that was ticked', () => {
    rememberWalletHeadStart('goal-3', 100);
    const { onAddSavings } = setup('goal-3', {
      ready: true,
      busy: false,
      addAmount: '5000',
    });
    expect(onAddSavings).not.toHaveBeenCalled();
    expect(pendingWalletHeadStart('goal-3')).toBeNull();
  });

  it('does nothing for a plan without a pay-now head start', () => {
    const { onAddSavings, result } = setup('goal-4', {
      ready: true,
      busy: false,
      addAmount: '100',
    });
    expect(result.current).toBeNull();
    expect(onAddSavings).not.toHaveBeenCalled();
  });
});
