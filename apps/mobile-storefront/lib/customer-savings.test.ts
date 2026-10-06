import { describe, expect, it } from '@jest/globals';
import { mockFetchWithTimeout } from '@/lib/wallet-top-up.test-utils';

const {
  addSavingsContribution,
  createSavingsGoal,
  initializeSavingsAuthorization,
  listCustomerPaymentMethods,
  listSavingsGoals,
  cancelSavingsGoalFutureDebits,
  pauseSavingsGoal,
  resumeSavingsGoal,
  resolveSavingsGoalVariant,
  swapSavingsGoalDevice,
} =
  require('@/lib/customer-savings') as typeof import('@/lib/customer-savings');

describe('customer savings api client', () => {
  const apiErrorCases: Array<{
    name: string;
    call: () => Promise<unknown>;
  }> = [
    { name: 'listSavingsGoals', call: () => listSavingsGoals({}) },
    {
      name: 'createSavingsGoal',
      call: () =>
        createSavingsGoal({
          contributionAmount: 20000,
          contributionFrequency: 'daily',
          maturityDate: '2026-06-30',
          nonWithdrawableAccepted: true,
          productId: 'product-1',
          sourceMode: 'manual',
          startDate: '2026-05-20',
          targetAmount: 800000,
          termsAccepted: true,
        }),
    },
    {
      name: 'addSavingsContribution',
      call: () =>
        addSavingsContribution({
          amount: 20000,
          goalId: 'goal-1',
          idempotencyKey: 'idem-1',
        }),
    },
    {
      name: 'pauseSavingsGoal',
      call: () => pauseSavingsGoal({ goalId: 'goal-1' }),
    },
    {
      name: 'resumeSavingsGoal',
      call: () => resumeSavingsGoal({ goalId: 'goal-1' }),
    },
    {
      name: 'cancelSavingsGoalFutureDebits',
      call: () => cancelSavingsGoalFutureDebits({ goalId: 'goal-1' }),
    },
    {
      name: 'swapSavingsGoalDevice',
      call: () =>
        swapSavingsGoalDevice({
          goalId: 'goal-1',
          productId: '00000000-0000-4000-8000-000000000101',
          variantId: '00000000-0000-4000-8000-000000000102',
        }),
    },
    {
      name: 'resolveSavingsGoalVariant',
      call: () =>
        resolveSavingsGoalVariant({
          goalId: '00000000-0000-4000-8000-000000000101',
          variantId: '00000000-0000-4000-8000-000000000102',
        }),
    },
    {
      name: 'initializeSavingsAuthorization',
      call: () => initializeSavingsAuthorization({ amount: 100 }),
    },
    {
      name: 'listCustomerPaymentMethods',
      call: () => listCustomerPaymentMethods({}),
    },
  ];

  function mockHttpFailure() {
    mockFetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({
        code: 'SERVER_ERROR',
        error: 'Server says no',
      }),
    });
  }

  it('lists customer savings goals and parses summary', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        goals: [
          {
            breakFeePercent: 0,
            contributionAmount: 20000,
            contributionFrequency: 'daily',
            currentAmount: 120000,
            id: 'goal-1',
            maturityDate: '2026-06-30',
            productId: 'product-1',
            sourceMode: 'manual',
            startDate: '2026-05-20',
            status: 'active',
            targetAmount: 800000,
            title: 'iPhone savings',
            variantId: null,
          },
        ],
        summary: {
          activeGoalCount: 1,
          savingsBalance: 120000,
        },
      }),
    });

    await expect(listSavingsGoals({})).resolves.toEqual({
      goals: [
        expect.objectContaining({
          contributionAmount: 20000,
          currentAmount: 120000,
          id: 'goal-1',
        }),
      ],
      summary: {
        activeGoalCount: 1,
        savingsBalance: 120000,
      },
    });
  });

  it('creates a savings goal', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        contributionId: 'contrib-1',
        currentAmount: 20000,
        goalId: 'goal-1',
        goalStatus: 'active',
        success: true,
        walletBalance: 180000,
      }),
    });

    await expect(
      createSavingsGoal({
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        maturityDate: '2026-06-30',
        nonWithdrawableAccepted: true,
        productId: 'product-1',
        sourceMode: 'manual',
        startDate: '2026-05-20',
        targetAmount: 800000,
        termsAccepted: true,
      })
    ).resolves.toMatchObject({
      goalId: 'goal-1',
      success: true,
    });
  });

  it('accepts a staging goal creation response without echoed schedule fields', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        contributionId: null,
        currentAmount: 0,
        goalId: 'goal-staging',
        goalStatus: 'active',
        success: true,
        walletBalance: 0,
      }),
    });

    await expect(
      createSavingsGoal({
        contributionAmount: 20000,
        contributionFrequency: 'daily',
        maturityDate: '2026-06-30',
        nonWithdrawableAccepted: true,
        productId: 'product-1',
        sourceMode: 'manual',
        startDate: '2026-05-20',
        targetAmount: 800000,
        termsAccepted: true,
      })
    ).resolves.toMatchObject({ goalId: 'goal-staging', success: true });
  });

  it('adds a savings contribution', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        contributionId: 'contrib-2',
        goalCurrentAmount: 40000,
        goalStatus: 'active',
        success: true,
        walletBalance: 160000,
        walletTransactionId: 'wallet-txn-1',
      }),
    });

    await expect(
      addSavingsContribution({
        amount: 20000,
        goalId: 'goal-1',
        idempotencyKey: 'idem-1',
      })
    ).resolves.toMatchObject({
      contributionId: 'contrib-2',
      success: true,
    });
  });

  it('pauses a savings goal', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        goalStatus: 'paused',
        success: true,
      }),
    });

    await expect(pauseSavingsGoal({ goalId: 'goal-1' })).resolves.toEqual({
      goalStatus: 'paused',
      success: true,
    });
  });

  it('resumes a savings goal', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        goalStatus: 'active',
        success: true,
      }),
    });

    await expect(resumeSavingsGoal({ goalId: 'goal-1' })).resolves.toEqual({
      goalStatus: 'active',
      success: true,
    });
  });

  it('cancels future auto-debits for a savings goal', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        goalStatus: 'paused',
        success: true,
      }),
    });

    await expect(
      cancelSavingsGoalFutureDebits({ goalId: 'goal-1' })
    ).resolves.toEqual({
      goalStatus: 'paused',
      success: true,
    });
  });

  it('swaps a savings goal device', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        currentAmount: 120000,
        goalId: 'goal-1',
        goalStatus: 'active',
        success: true,
        targetAmount: 650000,
      }),
    });

    await expect(
      swapSavingsGoalDevice({
        goalId: 'goal-1',
        merchantSlug: 'ogabassey',
        productId: '00000000-0000-4000-8000-000000000101',
        variantId: '00000000-0000-4000-8000-000000000102',
      })
    ).resolves.toEqual({
      currentAmount: 120000,
      goalId: 'goal-1',
      goalStatus: 'active',
      success: true,
      targetAmount: 650000,
    });

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://usebaci.com/api/storefront/customer/savings/goals/swap-device',
      expect.objectContaining({
        body: JSON.stringify({
          goalId: 'goal-1',
          merchantSlug: 'ogabassey',
          productId: '00000000-0000-4000-8000-000000000101',
          variantId: '00000000-0000-4000-8000-000000000102',
        }),
        method: 'POST',
      })
    );
  });

  it.each(apiErrorCases)('propagates network failures from $name', async ({
    call,
  }) => {
    mockFetchWithTimeout.mockRejectedValue(new Error('Network unavailable'));

    await expect(call()).rejects.toThrow('Network unavailable');
  });

  it.each(apiErrorCases)('throws response errors from $name', async ({
    call,
  }) => {
    mockHttpFailure();

    await expect(call()).rejects.toThrow('Server says no');
  });
});
