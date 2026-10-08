import { describe, expect, it } from '@jest/globals';
import {
  CustomerPaymentMethodSchema,
  CustomerPaymentMethodsResponseSchema,
  ListSavingsGoalsResponseSchema,
  SavingsAuthorizationConfirmationResponseSchema,
  SavingsAuthorizationResponseSchema,
  SavingsContributionResponseSchema,
  SavingsDeviceSwapResponseSchema,
  SavingsGoalActionResponseSchema,
  SavingsGoalSchema,
  SavingsGoalSummarySchema,
  SavingsVariantResolutionResponseSchema,
} from '@/schemas/customer-savings';

it('parses completed variant resolution responses', () => {
  const input = { goalId: 'goal-1', goalStatus: 'completed', success: true };

  const result = SavingsVariantResolutionResponseSchema.parse(input);

  expect(result).toEqual(input);
});

it('rejects variant resolution responses for active goals', () => {
  const input = { goalId: 'goal-1', goalStatus: 'active', success: true };

  const result = SavingsVariantResolutionResponseSchema.safeParse(input);

  expect(result.success).toBe(false);
});

const validGoal = {
  breakFeePercent: 0,
  contributionAmount: 20000,
  contributionFrequency: 'daily',
  currentAmount: 120000,
  id: 'goal-1',
  maturityDate: '2026-06-30',
  productId: 'product-1',
  sourceMode: 'manual',
  startDate: '2026-05-21',
  status: 'active',
  targetAmount: 800000,
  title: 'iPhone savings',
  variantId: null,
};

const validDeviceSwapResponse = {
  currentAmount: 120000,
  goalId: 'goal-1',
  goalStatus: 'active',
  success: true,
  targetAmount: 650000,
};

describe('customer savings schemas', () => {
  it('parses a full valid savings goal', () => {
    expect(SavingsGoalSchema.parse(validGoal)).toEqual(validGoal);
  });

  it('rejects invalid savings goal enum and numeric values', () => {
    expect(() =>
      SavingsGoalSchema.parse({
        ...validGoal,
        contributionFrequency: 'yearly',
      })
    ).toThrow();
    expect(() =>
      SavingsGoalSchema.parse({
        ...validGoal,
        currentAmount: '120000',
      })
    ).toThrow();
  });

  // Previously asserted integer-only amounts (1.5 rejected). The ledger
  // stores numeric(12, 2), so kobo-precision values like 1.5 must parse;
  // only sub-kobo precision is rejected now.
  it('rejects invalid savings goal amount boundaries', () => {
    for (const field of ['contributionAmount', 'targetAmount'] as const) {
      for (const value of [0, -1, 1.015]) {
        expect(() =>
          SavingsGoalSchema.parse({
            ...validGoal,
            [field]: value,
          })
        ).toThrow();
      }
      expect(
        SavingsGoalSchema.parse({ ...validGoal, [field]: 1.5 })[field]
      ).toBe(1.5);
    }

    for (const value of [-1, 1.015]) {
      expect(() =>
        SavingsGoalSchema.parse({
          ...validGoal,
          currentAmount: value,
        })
      ).toThrow();
    }

    expect(
      SavingsGoalSchema.parse({
        ...validGoal,
        currentAmount: 0,
      }).currentAmount
    ).toBe(0);
  });

  it('rejects missing required savings goal fields', () => {
    for (const field of ['id', 'productId', 'status', 'title'] as const) {
      expect(() =>
        SavingsGoalSchema.parse({
          ...validGoal,
          [field]: undefined,
        })
      ).toThrow();
    }
  });

  it('rejects invalid savings goal date formats', () => {
    for (const field of ['maturityDate', 'startDate'] as const) {
      for (const value of ['2026/06/30', '2026-13-30', 'not-a-date']) {
        expect(() =>
          SavingsGoalSchema.parse({
            ...validGoal,
            [field]: value,
          })
        ).toThrow();
      }
    }
  });

  it('validates all savings API response schemas', () => {
    expect(
      SavingsGoalSummarySchema.parse({
        contributionAmount: 20000,
        contributionFrequency: 'weekly',
        currentAmount: 40000,
        goalId: 'goal-1',
        goalStatus: 'active',
        success: true,
        walletBalance: 160000,
      })
    ).toMatchObject({ goalStatus: 'active' });

    expect(
      ListSavingsGoalsResponseSchema.parse({
        goals: [validGoal],
        summary: { activeGoalCount: 1, savingsBalance: 120000 },
      }).goals
    ).toHaveLength(1);

    expect(
      SavingsContributionResponseSchema.parse({
        contributionId: 'contribution-1',
        goalCurrentAmount: 140000,
        goalStatus: 'active',
        success: true,
        walletBalance: 60000,
        walletTransactionId: null,
      })
    ).toMatchObject({ success: true });

    expect(
      SavingsGoalActionResponseSchema.parse({
        goalStatus: 'paused',
        success: true,
      })
    ).toEqual({ goalStatus: 'paused', success: true });

    expect(
      SavingsDeviceSwapResponseSchema.parse(validDeviceSwapResponse)
    ).toEqual(validDeviceSwapResponse);

    expect(
      SavingsAuthorizationResponseSchema.parse({
        authorization_url: 'https://checkout.paystack.com/auth',
        checkout_url: 'https://checkout.paystack.com/auth',
        gateway: 'paystack',
        reference: 'SAV-AUTH-1',
        success: true,
      })
    ).toMatchObject({ gateway: 'paystack' });
    expect(
      SavingsAuthorizationConfirmationResponseSchema.parse({
        reference: 'SAV-AUTH-1',
        savedPaymentMethodId: 'card-1',
        status: 'successful',
        success: true,
      })
    ).toMatchObject({ savedPaymentMethodId: 'card-1' });
    expect(
      SavingsAuthorizationConfirmationResponseSchema.parse({
        reference: 'SAV-AUTH-1',
        status: 'processing',
      })
    ).toMatchObject({ status: 'processing' });

    const paymentMethod = {
      bank: 'Access Bank',
      brand: 'visa',
      exp_month: '08',
      exp_year: '2030',
      id: 'card-1',
      is_default: true,
      label: 'Access Bank ending 1234',
      last4: '1234',
      provider: 'paystack',
    };
    expect(CustomerPaymentMethodSchema.parse(paymentMethod)).toEqual(
      paymentMethod
    );
    expect(
      CustomerPaymentMethodsResponseSchema.parse({ methods: [paymentMethod] })
        .methods
    ).toHaveLength(1);
  });

  it('still rejects invalid money fields in the older staging creation response', () => {
    expect(() =>
      SavingsGoalSummarySchema.parse({
        currentAmount: '0',
        goalId: 'goal-staging',
        goalStatus: 'active',
        success: true,
        walletBalance: 0,
      })
    ).toThrow();
  });

  it('rejects invalid savings device swap responses', () => {
    for (const currentAmount of [-1, 1.015]) {
      expect(() =>
        SavingsDeviceSwapResponseSchema.parse({
          ...validDeviceSwapResponse,
          currentAmount,
        })
      ).toThrow();
    }

    for (const targetAmount of [0, -1, 1.015]) {
      expect(() =>
        SavingsDeviceSwapResponseSchema.parse({
          ...validDeviceSwapResponse,
          targetAmount,
        })
      ).toThrow();
    }

    expect(() =>
      SavingsDeviceSwapResponseSchema.parse({
        ...validDeviceSwapResponse,
        goalStatus: 'archived',
      })
    ).toThrow();

    for (const field of [
      'currentAmount',
      'goalId',
      'goalStatus',
      'success',
      'targetAmount',
    ] as const) {
      const payload: Partial<typeof validDeviceSwapResponse> = {
        ...validDeviceSwapResponse,
      };
      delete payload[field];
      expect(() => SavingsDeviceSwapResponseSchema.parse(payload)).toThrow();
    }
  });

  it('rejects invalid response statuses', () => {
    expect(() =>
      SavingsGoalActionResponseSchema.parse({
        goalStatus: 'archived',
        success: true,
      })
    ).toThrow();
    expect(() =>
      SavingsContributionResponseSchema.parse({
        contributionId: 'contribution-1',
        goalCurrentAmount: 140000,
        goalStatus: 'archived',
        success: true,
        walletBalance: 60000,
        walletTransactionId: null,
      })
    ).toThrow();
    expect(() =>
      SavingsAuthorizationConfirmationResponseSchema.parse({
        reference: 'SAV-AUTH-1',
        status: 'successful',
        success: true,
      })
    ).toThrow();
  });

  it('accepts kobo-precision balances in goals responses', () => {
    // A 101-kobo transfer lands as numeric 1.01 in current_amount; the
    // whole goals response must parse instead of failing checkout.
    const result = ListSavingsGoalsResponseSchema.parse({
      goals: [{ ...validGoal, currentAmount: 1.01 }],
      summary: { activeGoalCount: 1, savingsBalance: 1.01 },
    });

    expect(result.goals[0]?.currentAmount).toBe(1.01);
    expect(
      SavingsContributionResponseSchema.parse({
        contributionId: 'contribution-1',
        goalCurrentAmount: 120000.5,
        goalStatus: 'active',
        success: true,
        walletBalance: 60000.25,
        walletTransactionId: null,
      }).goalCurrentAmount
    ).toBe(120000.5);
  });

  it('rejects sub-kobo precision and non-finite amounts', () => {
    expect(
      ListSavingsGoalsResponseSchema.safeParse({
        goals: [{ ...validGoal, currentAmount: 1.015 }],
        summary: { activeGoalCount: 1, savingsBalance: 0 },
      }).success
    ).toBe(false);
    expect(
      SavingsGoalSchema.safeParse({ ...validGoal, currentAmount: -1 }).success
    ).toBe(false);
    expect(
      SavingsGoalSchema.safeParse({
        ...validGoal,
        currentAmount: Number.POSITIVE_INFINITY,
      }).success
    ).toBe(false);
    expect(
      SavingsGoalSchema.safeParse({ ...validGoal, targetAmount: 0 }).success
    ).toBe(false);
  });
});
