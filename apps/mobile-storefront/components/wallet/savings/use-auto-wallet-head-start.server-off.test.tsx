import { act, renderHook } from '@testing-library/react-native';
import { walletHeadStarts } from './pending-wallet-head-start';
import { useAutoWalletHeadStart } from './use-auto-wallet-head-start';

type Props = {
  ready: boolean;
  addAmount: string;
  walletBalance?: number;
};

function setup(goalId: string, initial: Props) {
  const onAddSavings = jest.fn();
  const onAddAmountChange = jest.fn();
  const view = renderHook(
    (props: Props) =>
      useAutoWalletHeadStart({
        goalId,
        onAddSavings,
        onAddAmountChange,
        remainingAmount: 93500,
        ...props,
        walletBalance: props.walletBalance ?? 220,
      }),
    { initialProps: initial }
  );
  return { onAddSavings, onAddAmountChange, ...view };
}

describe('useAutoWalletHeadStart with PiggyVest off', () => {
  it('offers the ticked head start and moves it only on the customer tap, once', () => {
    walletHeadStarts.remember('goal-1', 100);
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
      walletHeadStarts.remember('goal-2', 100);
      const first = setup('goal-2', { ready: true, addAmount: '100' });
      first.unmount();
      expect(walletHeadStarts.lookup('goal-2')).toBe(100);
      const again = setup('goal-2', { ready: true, addAmount: '100' });
      expect(again.result.current.waiting).toBe(100);
      walletHeadStarts.take('goal-2');
    });

    it('puts a changed amount back to the head start instead of dropping it', () => {
      walletHeadStarts.remember('goal-3', 100);
      const { onAddSavings, onAddAmountChange, result } = setup('goal-3', {
        ready: true,
        addAmount: '5000',
      });
      expect(onAddAmountChange).toHaveBeenCalledWith('100');
      expect(result.current.canMove).toBe(false);
      act(() => result.current.move());
      expect(onAddSavings).not.toHaveBeenCalled();
      expect(walletHeadStarts.lookup('goal-3')).toBe(100);
      walletHeadStarts.take('goal-3');
    });
  });

  describe('bugfix (Muse): the tap did not re-check the wallet balance', () => {
    it('refuses the tap and keeps the head start when the wallet dropped below it', () => {
      walletHeadStarts.remember('goal-6', 100);
      const { onAddSavings, result, rerender } = setup('goal-6', {
        ready: true,
        addAmount: '100',
      });
      expect(result.current.canMove).toBe(true);
      rerender({ ready: true, addAmount: '100', walletBalance: 40 });
      expect(result.current.fits).toBe(false);
      expect(result.current.canMove).toBe(false);
      act(() => result.current.move());
      expect(onAddSavings).not.toHaveBeenCalled();
      expect(walletHeadStarts.lookup('goal-6')).toBe(100);
      walletHeadStarts.take('goal-6');
    });
  });

  describe('bugfix (Muse): a fast double press could start the transfer twice', () => {
    it('starts it once when Move is pressed twice before re-rendering', () => {
      walletHeadStarts.remember('goal-7', 100);
      const { onAddSavings, result } = setup('goal-7', {
        ready: true,
        addAmount: '100',
      });
      const { move } = result.current;
      act(() => {
        move();
        move();
      });
      expect(onAddSavings).toHaveBeenCalledTimes(1);
    });
  });

  describe('bugfix (Muse): a short wallet reset every typed amount to the head start', () => {
    it('leaves the customer amount alone once the head start no longer fits', () => {
      walletHeadStarts.remember('goal-8', 100);
      const { onAddAmountChange } = setup('goal-8', {
        ready: true,
        addAmount: '50',
        walletBalance: 40,
      });
      expect(onAddAmountChange).not.toHaveBeenCalled();
      walletHeadStarts.take('goal-8');
    });
  });

  it('lets the customer choose a different amount instead', () => {
    walletHeadStarts.remember('goal-4', 100);
    const { onAddSavings, result } = setup('goal-4', {
      ready: true,
      addAmount: '100',
    });
    act(() => result.current.dismiss());
    expect(result.current.waiting).toBeNull();
    expect(walletHeadStarts.lookup('goal-4')).toBeNull();
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
