import { act, renderHook } from '@testing-library/react-native';
import {
  pendingWalletHeadStart,
  rememberWalletHeadStart,
  takeWalletHeadStart,
} from './pending-wallet-head-start';
import { useAutoWalletHeadStart } from './use-auto-wallet-head-start';

type Props = { ready: boolean; addAmount: string };

function setup(goalId: string, initial: Props) {
  const onAddSavings = jest.fn();
  const onAddAmountChange = jest.fn();
  const view = renderHook(
    (props: Props) =>
      useAutoWalletHeadStart({
        goalId,
        onAddSavings,
        onAddAmountChange,
        ...props,
      }),
    { initialProps: initial }
  );
  return { onAddSavings, onAddAmountChange, ...view };
}

describe('useAutoWalletHeadStart with PiggyVest off', () => {
  it('offers the ticked head start and moves it only on the customer tap, once', () => {
    rememberWalletHeadStart('goal-1', 100);
    const { onAddSavings, result, rerender } = setup('goal-1', {
      ready: false,
      addAmount: '100',
    });
    expect(result.current.waiting).toBe(100);
    expect(result.current.canMove).toBe(false);
    rerender({ ready: true, addAmount: '100' });
    expect(result.current.canMove).toBe(true);
    expect(onAddSavings).not.toHaveBeenCalled();
    act(() => result.current.move());
    expect(onAddSavings).toHaveBeenCalledTimes(1);
    expect(result.current.waiting).toBeNull();
    act(() => result.current.move());
    expect(onAddSavings).toHaveBeenCalledTimes(1);
  });

  describe('bugfix (review): the head start was dropped before any transfer started', () => {
    it('keeps it across a remount while the plan is still getting ready', () => {
      rememberWalletHeadStart('goal-2', 100);
      const first = setup('goal-2', { ready: true, addAmount: '100' });
      first.unmount();
      expect(pendingWalletHeadStart('goal-2')).toBe(100);
      const again = setup('goal-2', { ready: true, addAmount: '100' });
      expect(again.result.current.waiting).toBe(100);
      takeWalletHeadStart('goal-2');
    });

    it('puts a changed amount back to the head start instead of dropping it', () => {
      rememberWalletHeadStart('goal-3', 100);
      const { onAddSavings, onAddAmountChange, result } = setup('goal-3', {
        ready: true,
        addAmount: '5000',
      });
      expect(onAddAmountChange).toHaveBeenCalledWith('100');
      expect(result.current.canMove).toBe(false);
      act(() => result.current.move());
      expect(onAddSavings).not.toHaveBeenCalled();
      expect(pendingWalletHeadStart('goal-3')).toBe(100);
      takeWalletHeadStart('goal-3');
    });
  });

  it('lets the customer choose a different amount instead', () => {
    rememberWalletHeadStart('goal-4', 100);
    const { onAddSavings, result } = setup('goal-4', {
      ready: true,
      addAmount: '100',
    });
    act(() => result.current.dismiss());
    expect(result.current.waiting).toBeNull();
    expect(pendingWalletHeadStart('goal-4')).toBeNull();
    expect(onAddSavings).not.toHaveBeenCalled();
  });

  it('does nothing for a plan without a pay-now head start', () => {
    const { onAddSavings, result } = setup('goal-5', {
      ready: true,
      addAmount: '100',
    });
    expect(result.current.waiting).toBeNull();
    act(() => result.current.move());
    expect(onAddSavings).not.toHaveBeenCalled();
  });
});
