import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useCardOnlyPurchaseTopUp } from './use-card-only-purchase-top-up';

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
let mockCapability: boolean | null = false;
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => mockCapability,
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: '' } }));

describe('useCardOnlyPurchaseTopUp', () => {
  beforeEach(() => {
    mockCapability = false;
  });

  it("keeps today's top-up when the server keeps PiggyVest off", () => {
    const { result } = renderHook(() => useCardOnlyPurchaseTopUp(PILOT, false));
    expect(result.current).toBe(false);
  });

  it('bugfix: is card-only for a PiggyVest merchant whose read is unknown', () => {
    mockCapability = null;
    const { result } = renderHook(() => useCardOnlyPurchaseTopUp(PILOT, false));
    expect(result.current).toBe(true);
  });

  it('is card-only once the wallet is store credit', () => {
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp('merchant-1', true)
    );
    expect(result.current).toBe(true);
  });
});
