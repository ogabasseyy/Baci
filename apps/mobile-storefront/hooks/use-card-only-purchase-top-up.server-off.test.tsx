import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useCardOnlyPurchaseTopUp } from './use-card-only-purchase-top-up';

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const ROLLOUT = '0f6c1a2e-3b4d-4e5f-8a9b-1c2d3e4f5a6b';
const LEGACY_WALLET = {};
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
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp(PILOT, LEGACY_WALLET)
    );
    expect(result.current).toBe(false);
  });

  it('bugfix: is card-only for a PiggyVest merchant whose read is unknown', () => {
    mockCapability = null;
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp(PILOT, LEGACY_WALLET)
    );
    expect(result.current).toBe(true);
  });

  it('is card-only once the wallet is store credit', () => {
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp('merchant-1', { primary_balance_kobo: 500_000 })
    );
    expect(result.current).toBe(true);
  });
});

describe('bugfix: unobserved rollout merchant with a timed-out PiggyVest read', () => {
  it('is card-only so the IMEI shortfall prefill meets the card minimum', () => {
    // Arrange: not a pilot, capability not cached yet, first read timed out.
    mockCapability = null;

    // Act
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp(ROLLOUT, {
        primary_unavailable: true,
      })
    );

    // Assert
    expect(result.current).toBe(true);
  });

  it('is card-only while the PiggyVest account is pending', () => {
    mockCapability = null;
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp(ROLLOUT, { primary_pending: true })
    );
    expect(result.current).toBe(true);
  });

  it("keeps today's exact prefill for an unobserved merchant's legacy wallet", () => {
    mockCapability = null;
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp(ROLLOUT, LEGACY_WALLET)
    );
    expect(result.current).toBe(false);
  });
});
