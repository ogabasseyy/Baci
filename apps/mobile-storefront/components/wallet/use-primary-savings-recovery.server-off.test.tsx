import { renderHook, waitFor } from '@testing-library/react-native';
import { usePrimarySavingsRecovery } from './use-primary-savings-recovery';

jest.mock('@/lib/piggyvest-primary-capability', () => ({
  rollbackObservedCapabilityOnNotReady: jest.fn(),
  usePiggyvestPrimaryCapability: () => false,
}));
jest.mock('@/lib/piggyvest-primary-savings-recovery', () => ({
  recoverPiggyvestPrimarySavings: jest.fn(async () => null),
}));

// With PiggyVest off the durable lookup finds nothing: no operation and no
// rail are adopted, and the legacy flow is released.
describe('server keeps PiggyVest off', () => {
  it('adopts no operation and no rail', async () => {
    const operationRef = { current: null as string | null };
    const railRef = { current: null as 'primary' | 'legacy' | null };
    const setAmount = jest.fn();
    const { result } = renderHook(() =>
      usePrimarySavingsRecovery({
        merchantId: 'm',
        userId: 'u',
        goalId: 'g',
        operationRef,
        railRef,
        setAmount,
      })
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(operationRef.current).toBeNull();
    expect(railRef.current).toBeNull();
  });
});
