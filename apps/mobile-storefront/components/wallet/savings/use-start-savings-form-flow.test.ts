import { act, renderHook } from '@testing-library/react-native';
import { useStartSavingsFormFlow } from './use-start-savings-form-flow';

const mockListGoals = jest.fn();
jest.mock('@/lib/customer-savings', () => ({
  listSavingsGoals: (...args: unknown[]) => mockListGoals(...args),
}));

function createInput() {
  return {
    acceptsNonWithdrawableTerms: true,
    contributionValue: 100,
    initialContributionEnabled: false,
    initialContributionValue: 0,
    refetch: jest.fn(async () => undefined),
    selectedFundingOption: 'bank_transfer' as const,
    selectedPaymentMethodId: null,
    selectedProduct: null,
    setCreatedGoalId: jest.fn(),
    setFormError: jest.fn(),
    setInitialContributionAmount: jest.fn(),
    setInitialContributionEnabled: jest.fn(),
    setPaymentMethodsError: jest.fn(),
    setShowPreviewModal: jest.fn(),
    setShowSuccessModal: jest.fn(),
    setShowTransferModal: jest.fn(),
    setSourceMode: jest.fn(),
    sourceMode: 'manual' as const,
    submitSavingsGoal: jest.fn(async () => undefined),
    targetValue: 250000,
    transferVerification: {
      goalId: 'created-goal',
      amount: 100,
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    },
  };
}

describe('plan transfer backend confirmation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ignores a confirmation that arrives after changing the plan or account', async () => {
    let resolveGoals!: (value: {
      goals: { id: string; currentAmount: number }[];
    }) => void;
    mockListGoals.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGoals = resolve;
        })
    );
    const input = createInput();
    const { result, rerender } = renderHook(
      (props: ReturnType<typeof createInput>) => useStartSavingsFormFlow(props),
      { initialProps: input }
    );
    const pending = result.current.confirmPlanTransfer();

    rerender({
      ...input,
      transferVerification: {
        ...input.transferVerification,
        goalId: 'different-goal',
      },
    });
    await act(async () => {
      resolveGoals({ goals: [{ id: 'created-goal', currentAmount: 100 }] });
      await pending;
    });

    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
    expect(input.setCreatedGoalId).not.toHaveBeenCalledWith(null);
  });

  it('does not show success when refreshing succeeds but the plan has no verified funds', async () => {
    mockListGoals.mockResolvedValue({
      goals: [{ id: 'created-goal', currentAmount: 0 }],
    });
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsFormFlow(input));

    await act(async () => result.current.confirmPlanTransfer());

    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
    expect(input.setShowTransferModal).not.toHaveBeenCalledWith(false);
    expect(input.setCreatedGoalId).not.toHaveBeenCalledWith(null);
    expect(input.setFormError).toHaveBeenCalledWith(
      'Your transfer is not confirmed yet. Check again after the money reaches this plan.'
    );
  });

  it('does not treat a different funded plan as confirmation', async () => {
    mockListGoals.mockResolvedValue({
      goals: [{ id: 'other-goal', currentAmount: 10000 }],
    });
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsFormFlow(input));

    await act(async () => result.current.confirmPlanTransfer());

    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
  });

  it('shows success only after the exact plan is funded on the backend', async () => {
    mockListGoals.mockResolvedValue({
      goals: [{ id: 'created-goal', currentAmount: 100 }],
    });
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsFormFlow(input));

    await act(async () => result.current.confirmPlanTransfer());

    expect(mockListGoals).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('fails closed when the backend status check fails', async () => {
    mockListGoals.mockRejectedValue(new Error('Network request failed'));
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsFormFlow(input));

    await act(async () => result.current.confirmPlanTransfer());

    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
    expect(input.setCreatedGoalId).not.toHaveBeenCalledWith(null);
  });
});
