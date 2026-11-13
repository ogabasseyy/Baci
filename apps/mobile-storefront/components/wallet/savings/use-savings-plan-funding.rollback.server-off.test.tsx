import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { useSavingsPlanFunding } from './use-savings-plan-funding';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
// The mounted capability hook keeps its earlier positive answer.
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => true,
}));

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

afterEach(() => {
  clearObservedPiggyvestPrimaryCapability();
});

describe('bugfix: savings setup hid the BVN after a wallet-read rollback', () => {
  it('shows the BVN field again without a remount once the verdict rolls back', () => {
    // Arrange: PiggyVest confirmed, so the BVN field is hidden.
    observePiggyvestPrimaryCapability(PILOT, true);
    const { result } = renderHook(() =>
      useSavingsPlanFunding({
        activeMerchantId: PILOT,
        goalId: '0f8fad5b-d9cb-469f-a165-70867728950e',
        identityKey: 'user-a',
      })
    );
    expect(result.current.planFundingRequiresBvn).toBe(false);

    // Act: the wallet read answers not ready and rolls the verdict back.
    act(() => observePiggyvestPrimaryCapability(PILOT, false));

    // Assert: the legacy setup collects a BVN.
    expect(result.current.planFundingRequiresBvn).toBe(true);
  });
});
