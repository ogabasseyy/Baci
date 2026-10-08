import { describe, expect, it, jest } from '@jest/globals';
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

import { useSavingsPlanFunding } from './use-savings-plan-funding';

const input = {
  activeMerchantId: 'merchant-1',
  activeMerchantSlug: 'ogabassey',
  goalId: 'goal-1',
  identityKey: 'merchant-1',
};
function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useSavingsPlanFunding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCapability.mockReturnValue(null);
  });
  it('loads the existing goal mapping before any BVN provisioning request', async () => {
    mockFetchExistingSavingsPlanFunding.mockResolvedValue({
      status: 'pending',
      code: 'MAPPING_PENDING',
    });
    const { result } = renderHook(() =>
      useSavingsPlanFunding({ ...input, loadExisting: true })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockFetchExistingSavingsPlanFunding).toHaveBeenCalledWith({
      goalId: 'goal-1',
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
    expect(mockFetchSavingsPlanFunding).not.toHaveBeenCalled();
    expect(result.current.planFundingPhase).toBe('pending');
    expect(result.current.planFundingStatusCode).toBe('MAPPING_PENDING');
  });
  it('keeps a failed existing-mapping request in an error retry state', async () => {
    mockFetchExistingSavingsPlanFunding.mockRejectedValue(
      new Error('Service unavailable')
    );

    const { result } = renderHook(() =>
      useSavingsPlanFunding({ ...input, loadExisting: true })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.planFundingPhase).toBe('error');
    expect(result.current.fundingError).toBe('Service unavailable');
    expect(mockFetchSavingsPlanFunding).not.toHaveBeenCalled();
  });
  it('rejects a malformed BVN without calling the endpoint', async () => {
    const { result } = renderHook(() => useSavingsPlanFunding(input));

    await act(async () => {
      await result.current.fetchPlanFunding('123');
    });
    expect(mockFetchSavingsPlanFunding).not.toHaveBeenCalled();
    expect(result.current.planFundingPhase).toBe('error');
    expect(result.current.fundingError).toMatch(/11-digit/);
  });

  it('requires a created plan before fetching', async () => {
    const { result } = renderHook(() =>
      useSavingsPlanFunding({ ...input, goalId: null })
    );

    await act(async () => {
      await result.current.fetchPlanFunding('00000000000');
    });
    expect(mockFetchSavingsPlanFunding).not.toHaveBeenCalled();
    expect(result.current.planFundingPhase).toBe('error');
  });

  it('publishes ready accounts from the funding endpoint', async () => {
    mockFetchSavingsPlanFunding.mockResolvedValue({
      status: 'ready',
      accounts: [
        {
          accountNumber: '0001234567',
          accountName: 'Synthetic account',
          bankName: 'Synthetic bank',
        },
      ],
    });
    const { result } = renderHook(() => useSavingsPlanFunding(input));

    await act(async () => {
      await result.current.fetchPlanFunding('00000000000');
    });
    expect(mockFetchSavingsPlanFunding).toHaveBeenCalledWith({
      bvn: '00000000000',
      goalId: 'goal-1',
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
    expect(result.current.planFundingPhase).toBe('ready');
    expect(result.current.planFundingAccounts).toEqual([
      {
        accountNumber: '0001234567',
        accountName: 'Synthetic account',
        bankName: 'Synthetic bank',
      },
    ]);
  });

  it('forwards the interest opt-in to the funding endpoint', async () => {
    mockFetchSavingsPlanFunding.mockResolvedValue({ status: 'pending' });
    const { result } = renderHook(() => useSavingsPlanFunding(input));

    await act(async () => {
      await result.current.fetchPlanFunding('00000000000', {
        enableInterestAccrual: true,
      });
    });
    expect(mockFetchSavingsPlanFunding).toHaveBeenCalledWith(
      expect.objectContaining({ enableInterestAccrual: true })
    );
  });

  it('surfaces pending provisioning as a retryable phase', async () => {
    mockFetchSavingsPlanFunding.mockResolvedValue({
      status: 'pending',
      code: 'PROVISIONING_IN_PROGRESS',
    });
    const { result } = renderHook(() => useSavingsPlanFunding(input));

    await act(async () => {
      await result.current.fetchPlanFunding('00000000000');
    });

    expect(result.current.planFundingPhase).toBe('pending');
    expect(result.current.planFundingStatusCode).toBe(
      'PROVISIONING_IN_PROGRESS'
    );
  });

  it('ignores an old provisioning response after the goal and merchant scope change', async () => {
    const oldProvisioning = createDeferred<unknown>();
    const newMapping = createDeferred<unknown>();
    mockFetchSavingsPlanFunding.mockReturnValueOnce(oldProvisioning.promise);
    mockFetchExistingSavingsPlanFunding.mockReturnValueOnce(newMapping.promise);
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useSavingsPlanFunding>[0]) =>
        useSavingsPlanFunding(props),
      { initialProps: { ...input, loadExisting: false } }
    );

    let request: Promise<void> | undefined;
    act(() => {
      request = result.current.fetchPlanFunding('00000000000');
    });

    rerender({
      activeMerchantId: 'merchant-2',
      activeMerchantSlug: 'new-store',
      goalId: 'goal-2',
      identityKey: 'customer-2',
      loadExisting: true,
    });

    await act(async () => {
      await Promise.resolve();
      newMapping.resolve({
        status: 'ready',
        accounts: [
          {
            accountName: 'New customer account',
            accountNumber: '0009876543',
            bankName: 'New bank',
          },
        ],
      });
      await Promise.resolve();
    });

    await act(async () => {
      oldProvisioning.resolve({
        status: 'ready',
        accounts: [
          {
            accountName: 'Old customer account',
            accountNumber: '0001234567',
            bankName: 'Old bank',
          },
        ],
      });
      await request;
    });

    expect(mockFetchExistingSavingsPlanFunding).toHaveBeenCalledWith({
      goalId: 'goal-2',
      merchantId: 'merchant-2',
      merchantSlug: 'new-store',
    });
    expect(result.current.planFundingPhase).toBe('ready');
    expect(result.current.planFundingAccounts).toEqual([
      {
        accountName: 'New customer account',
        accountNumber: '0009876543',
        bankName: 'New bank',
      },
    ]);
  });

  it('ignores an old mapping lookup after the merchant slug changes', async () => {
    const oldMapping = createDeferred<unknown>();
    const newMapping = createDeferred<unknown>();
    mockFetchExistingSavingsPlanFunding
      .mockReturnValueOnce(oldMapping.promise)
      .mockReturnValueOnce(newMapping.promise);
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useSavingsPlanFunding>[0]) =>
        useSavingsPlanFunding(props),
      { initialProps: { ...input, loadExisting: true } }
    );

    await act(async () => {
      await Promise.resolve();
    });

    rerender({
      activeMerchantId: 'merchant-1',
      activeMerchantSlug: 'new-store',
      goalId: 'goal-2',
      identityKey: 'customer-2',
      loadExisting: true,
    });

    await act(async () => {
      await Promise.resolve();
      newMapping.resolve({
        status: 'ready',
        accounts: [
          {
            accountName: 'Current account',
            accountNumber: '0009876543',
            bankName: 'Current bank',
          },
        ],
      });
      await Promise.resolve();
    });

    await act(async () => {
      oldMapping.resolve({ status: 'pending', code: 'MAPPING_PENDING' });
      await Promise.resolve();
    });

    expect(mockFetchExistingSavingsPlanFunding).toHaveBeenLastCalledWith({
      goalId: 'goal-2',
      merchantId: 'merchant-1',
      merchantSlug: 'new-store',
    });
    expect(result.current.planFundingPhase).toBe('ready');
    expect(result.current.planFundingAccounts[0]?.accountNumber).toBe(
      '0009876543'
    );
  });

  it('invalidates a pending lookup when the funding screen unmounts', async () => {
    const pendingMapping = createDeferred<unknown>();
    mockFetchExistingSavingsPlanFunding.mockReturnValueOnce(
      pendingMapping.promise
    );
    const { unmount } = renderHook(() =>
      useSavingsPlanFunding({ ...input, loadExisting: true })
    );

    unmount();

    await act(async () => {
      pendingMapping.resolve({ status: 'ready', accounts: [] });
      await Promise.resolve();
    });

    expect(mockFetchExistingSavingsPlanFunding).toHaveBeenCalledTimes(1);
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
});
