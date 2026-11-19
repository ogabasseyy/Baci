import { renderHook } from '@testing-library/react-native';
import { useWalletSavingsRefs } from './use-wallet-savings-refs';

describe('useWalletSavingsRefs', () => {
  it('starts empty and keeps the same refs across renders', () => {
    const { result, rerender } = renderHook(() => useWalletSavingsRefs());
    const first = result.current;
    expect(first.idempotencyKeyRef.current).toBeNull();
    expect(first.operationRailRef.current).toBeNull();
    first.idempotencyKeyRef.current = 'op';
    rerender({});
    expect(result.current.idempotencyKeyRef).toBe(first.idempotencyKeyRef);
    expect(result.current.idempotencyKeyRef.current).toBe('op');
  });
});
