import { describe, expect, it } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useWalletSavingsAmount } from './use-wallet-savings-amount';

describe('useWalletSavingsAmount', () => {
  it('prefills the savings amount when a confirmed wallet payment returns', () => {
    const { result } = renderHook(() =>
      useWalletSavingsAmount('savings', '500')
    );

    expect(result.current[0]).toBe('500');
  });

  it('syncs a new payment return amount without resetting later edits', () => {
    const { result, rerender } = renderHook(
      ({ action, routeAmount }: { action: string; routeAmount: string }) =>
        useWalletSavingsAmount(action, routeAmount),
      { initialProps: { action: 'fund', routeAmount: '' } }
    );

    rerender({ action: 'savings', routeAmount: '500' });
    expect(result.current[0]).toBe('500');

    act(() => result.current[1]('400'));
    rerender({ action: 'savings', routeAmount: '500' });
    expect(result.current[0]).toBe('400');
  });
});
