import { expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { observePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability-cache';
import { useStartSavingsSubmit } from './use-start-savings-submit';
import { createInput } from './use-start-savings-submit.test-utils';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-intent' }));
jest.mock('@/lib/customer-savings', () => ({}));
jest.mock('@/lib/clipboard', () => ({}));
jest.mock('@/services/savings-reminder-notifications', () => ({}));

it('returns to the existing non-primary plan after wallet funding', () => {
  observePiggyvestPrimaryCapability('merchant-1', false);
  const input = createInput({
    createdGoalId: 'goal&other=1',
    effectiveInitialContribution: 12000,
  });
  const { result } = renderHook(() => useStartSavingsSubmit(input));

  act(() => result.current.openWalletFundingScreen());

  expect(mockPush).toHaveBeenCalledWith(
    expect.objectContaining({
      pathname: '/wallet',
      params: expect.objectContaining({
        action: 'fund',
        returnTo:
          '/wallet?action=savings&savingsGoalId=goal%26other%3D1&savingsAmount=12000',
      }),
    })
  );
});
