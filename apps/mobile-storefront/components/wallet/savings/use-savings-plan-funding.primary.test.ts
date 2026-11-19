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
const mockUseCapability = jest.fn<(...args: unknown[]) => unknown>();
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: (...args: unknown[]) =>
    mockUseCapability(...args),
}));

import { PLAN_NOT_SET_UP_MESSAGE } from '@/lib/customer-savings-plan-funding';
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
  expect(JSON.stringify(result.current)).not.toContain('1234567890');
  await act(async () => {
    await result.current.fetchExistingPlanFunding();
  });
  expect(result.current.planFundingPhase).toBe('pending');
});
it('uses the verified primary identity without requiring BVN again', async () => {
  mockUseCapability.mockReturnValue(true);
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
it('requires BVN for primary merchants when the server reports unconfigured', async () => {
  mockUseCapability.mockReturnValue(false);
  const { result } = renderHook(() =>
    useSavingsPlanFunding({
      ...input,
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    })
  );
  expect(result.current.planFundingRequiresBvn).toBe(true);
});
it('skips BVN for primary merchants while the capability is confirmed', async () => {
  mockUseCapability.mockReturnValue(true);
  const { result } = renderHook(() =>
    useSavingsPlanFunding({
      ...input,
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    })
  );
  expect(result.current.planFundingRequiresBvn).toBe(false);
});
it('requires BVN for primary merchants while the capability probe is pending', async () => {
  mockUseCapability.mockReturnValue(null);
  const { result } = renderHook(() =>
    useSavingsPlanFunding({
      ...input,
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    })
  );
  expect(result.current.planFundingRequiresBvn).toBe(true);
});

it('maps the endpoint SAVINGS_WALLET_NOT_FOUND error to the not-set-up state', async () => {
  mockFetchExistingSavingsPlanFunding.mockRejectedValueOnce(
    Object.assign(new Error('Savings wallet setup has not started.'), {
      code: 'SAVINGS_WALLET_NOT_FOUND',
    })
  );
  const { result } = renderHook(() => useSavingsPlanFunding(input));
  await act(async () => {
    await result.current.fetchExistingPlanFunding();
  });
  expect(result.current.planFundingPhase).toBe('error');
  expect(result.current.fundingError).toBe(PLAN_NOT_SET_UP_MESSAGE);
});

it('reads a never-started goal as still being set up when the caller asks for it', async () => {
  mockFetchExistingSavingsPlanFunding.mockRejectedValueOnce(
    Object.assign(new Error('not found'), { code: 'SAVINGS_WALLET_NOT_FOUND' })
  );
  const { result } = renderHook(() =>
    useSavingsPlanFunding({ ...input, notFoundMeansPending: true })
  );
  await act(async () => {
    await result.current.fetchExistingPlanFunding();
  });
  expect(result.current.planFundingPhase).toBe('pending');
  expect(result.current.fundingError).toBeNull();
});

it('still reports other status failures as errors for a status-only caller', async () => {
  mockFetchExistingSavingsPlanFunding.mockRejectedValueOnce(
    new Error('network down')
  );
  const { result } = renderHook(() =>
    useSavingsPlanFunding({ ...input, notFoundMeansPending: true })
  );
  await act(async () => {
    await result.current.fetchExistingPlanFunding();
  });
  expect(result.current.planFundingPhase).toBe('error');
});
