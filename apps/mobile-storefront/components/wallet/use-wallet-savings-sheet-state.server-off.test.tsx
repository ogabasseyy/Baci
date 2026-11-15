import { act, renderHook } from '@testing-library/react-native';
import { useWalletSavingsSheetState } from './use-wallet-savings-sheet-state';

// Local UI state only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: useWalletSavingsSheetState', () => {
  it('opens on a savings route and passes the route goal through', () => {
    const { result } = renderHook(() =>
      useWalletSavingsSheetState('savings', 'goal-r')
    );
    expect(result.current.showSavingsProgressModal).toBe(true);
    expect(result.current.goalPin.goalId).toBe('goal-r');
  });

  it('starts closed elsewhere and tracks a contribution in flight', () => {
    const { result } = renderHook(() =>
      useWalletSavingsSheetState(undefined, undefined)
    );
    expect(result.current.showSavingsProgressModal).toBe(false);
    act(() => result.current.setIsAddingSavingsContribution(true));
    expect(result.current.isAddingSavingsContribution).toBe(true);
  });
});
