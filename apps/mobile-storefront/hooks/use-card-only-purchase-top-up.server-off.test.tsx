import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
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

  it('bugfix: is card-only for a restored legacy wallet before any verdict', () => {
    // Arrange: no PiggyVest verdict yet (hook and cache unknown), so the
    // Add money sheet will treat this as a card-only store credit top-up.
    mockCapability = null;

    // Act
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp(ROLLOUT, LEGACY_WALLET)
    );

    // Assert
    expect(result.current).toBe(true);
  });

  it("keeps today's exact prefill once the server rules PiggyVest out", () => {
    mockCapability = false;
    observePiggyvestPrimaryCapability(ROLLOUT, false);
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp(ROLLOUT, LEGACY_WALLET)
    );
    clearObservedPiggyvestPrimaryCapability();
    expect(result.current).toBe(false);
  });
});

describe('bugfix: IMEI top-up below the card minimum for an unresolved wallet owner', () => {
  it('is card-only while the owner is unresolved and capability is unknown', () => {
    // Arrange: rollout merchant, capability probe pending, no customer row.
    mockCapability = null;

    // Act
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp(ROLLOUT, { owner_unresolved: true })
    );

    // Assert
    expect(result.current).toBe(true);
  });

  it("keeps today's exact prefill where the server rules PiggyVest out", () => {
    mockCapability = false;
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp(ROLLOUT, { owner_unresolved: true })
    );
    expect(result.current).toBe(false);
  });
});

describe('bugfix: rollback kept an unresolved owner card-only', () => {
  it('is not card-only for an unresolved owner once PiggyVest is ruled out now', () => {
    mockCapability = true; // stale hook value from before the rollback
    observePiggyvestPrimaryCapability('merchant-1', false);
    const { result } = renderHook(() =>
      useCardOnlyPurchaseTopUp('merchant-1', { owner_unresolved: true })
    );
    expect(result.current).toBe(false);
  });
});
