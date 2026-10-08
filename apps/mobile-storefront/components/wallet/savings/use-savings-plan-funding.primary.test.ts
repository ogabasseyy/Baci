import { expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

const mockFetchSavingsPlanFunding =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockFetchExistingSavingsPlanFunding =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: (...args: unknown[]) =>
    mockFetchExistingSavingsPlanFunding(...args),
  fetchSavingsPlanFunding: (...args: unknown[]) =>
    mockFetchSavingsPlanFunding(...args),
}));

import { useSavingsPlanFunding } from './use-savings-plan-funding';

const input = {
  activeMerchantId: 'merchant-1',
  activeMerchantSlug: 'ogabassey',
  goalId: 'goal-1',
  identityKey: 'merchant-1',
};
beforeEach(() => jest.clearAllMocks());

it('reads existing legacy account status without BVN or a provisioning request', async () => {
  mockFetchExistingSavingsPlanFunding.mockResolvedValueOnce({
    status: 'pending',
  });
  const { result } = renderHook(() => useSavingsPlanFunding(input));
  await act(async () => {
    await result.current.fetchExistingPlanFunding();
  });
  expect(mockFetchExistingSavingsPlanFunding).toHaveBeenCalledWith({
    goalId: input.goalId,
    merchantId: input.activeMerchantId,
    merchantSlug: input.activeMerchantSlug,
  });
  expect(mockFetchSavingsPlanFunding).not.toHaveBeenCalled();
  expect(result.current.planFundingPhase).toBe('pending');
});

it('clears displayed accounts when verification stops reporting readiness', async () => {
  mockFetchSavingsPlanFunding.mockResolvedValueOnce({
    status: 'ready',
    accounts: [
      { accountNumber: '1234567890', accountName: 'Test', bankName: 'Test' },
    ],
  });
  mockFetchExistingSavingsPlanFunding.mockResolvedValueOnce({
    status: 'pending',
  });
  const { result } = renderHook(() => useSavingsPlanFunding(input));
  await act(async () => {
    await result.current.fetchPlanFunding('00000000000');
  });
  expect(result.current.planFundingAccounts).toHaveLength(1);
  await act(async () => {
    await result.current.fetchExistingPlanFunding();
  });
  expect(result.current.planFundingPhase).toBe('pending');
  expect(result.current.planFundingAccounts).toEqual([]);
});
it('uses the verified primary identity without requiring BVN again', async () => {
  mockFetchSavingsPlanFunding.mockResolvedValue({ status: 'pending' });
  const { result } = renderHook(() =>
    useSavingsPlanFunding({
      ...input,
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    })
  );
  await act(async () => {
    await result.current.fetchPlanFunding('', {
      enableInterestAccrual: true,
    });
  });
  expect(mockFetchSavingsPlanFunding).toHaveBeenCalledWith({
    bvn: '',
    goalId: input.goalId,
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    merchantSlug: input.activeMerchantSlug,
    enableInterestAccrual: true,
  });
  expect(result.current.planFundingPhase).toBe('pending');
});
