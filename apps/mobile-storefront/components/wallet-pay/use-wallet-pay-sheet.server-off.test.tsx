import { act, renderHook } from '@testing-library/react-native';
import { useWalletPaySheet } from './use-wallet-pay-sheet';

describe('useWalletPaySheet with the server keeping PiggyVest off', () => {
  it('starts closed and, when the server says paused, never asks for a PIN or pays', async () => {
    const onDelivered = jest.fn();
    const hook = renderHook(() => useWalletPaySheet<string>({ onDelivered }));
    expect(hook.result.current.step).toBe('closed');

    const adapter = {
      start: jest.fn(async () => ({
        kind: 'outcome' as const,
        outcome: { kind: 'unavailable' as const },
      })),
      verifyPin: jest.fn(),
      pay: jest.fn(),
    };
    await act(async () => {
      await hook.result.current.open(adapter);
    });

    expect(hook.result.current.step).toBe('outcome');
    expect(hook.result.current.outcome).toEqual({ kind: 'unavailable' });
    expect(adapter.verifyPin).not.toHaveBeenCalled();
    expect(adapter.pay).not.toHaveBeenCalled();
    expect(onDelivered).not.toHaveBeenCalled();
  });
});
