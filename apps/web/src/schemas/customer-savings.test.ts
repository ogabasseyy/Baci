import { describe, expect, it } from 'vitest';
import {
  customerSavingsAuthorizationConfirmSchema,
  customerSavingsAutoDebitAuthorizeSchema,
  customerSavingsCreateGoalSchema,
  customerSavingsGoalActionSchema,
  customerSavingsManualContributionSchema,
} from '@/schemas/customer-savings';

const VALID_MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
const VALID_PRODUCT_ID = '00000000-0000-4000-8000-000000000002';
const VALID_GOAL_ID = '00000000-0000-4000-8000-000000000003';
const VALID_PAYMENT_METHOD_ID = '00000000-0000-4000-8000-000000000004';

describe('customer savings schemas', () => {
  it('parses a valid manual savings goal payload', () => {
    const result = customerSavingsCreateGoalSchema.parse({
      contributionAmount: '20000',
      contributionFrequency: 'daily',
      initialContributionAmount: 0,
      maturityDate: '2026-07-01',
      merchantSlug: 'ogabassey',
      nonWithdrawableAccepted: true,
      productId: VALID_PRODUCT_ID,
      sourceMode: 'manual',
      startDate: '2026-06-01',
      targetAmount: 800000,
      termsAccepted: true,
      title: 'iPhone 13 savings',
    });

    expect(result).toMatchObject({
      contributionAmount: 20000,
      contributionFrequency: 'daily',
      merchantSlug: 'ogabassey',
      sourceMode: 'manual',
      targetAmount: 800000,
      title: 'iPhone 13 savings',
    });
  });

  it('requires merchant slug or merchant id for goal creation', () => {
    const result = customerSavingsCreateGoalSchema.safeParse({
      contributionAmount: 20000,
      contributionFrequency: 'weekly',
      maturityDate: '2026-07-01',
      nonWithdrawableAccepted: true,
      productId: VALID_PRODUCT_ID,
      sourceMode: 'manual',
      startDate: '2026-06-01',
      targetAmount: 800000,
      termsAccepted: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Merchant slug or id is required',
            path: ['merchantSlug'],
          }),
        ])
      );
    }
  });

  it('requires saved card and consent for auto debit goal creation', () => {
    const result = customerSavingsCreateGoalSchema.safeParse({
      contributionAmount: 20000,
      contributionFrequency: 'monthly',
      maturityDate: '2026-08-01',
      merchantId: VALID_MERCHANT_ID,
      nonWithdrawableAccepted: true,
      productId: VALID_PRODUCT_ID,
      sourceMode: 'auto_debit',
      startDate: '2026-06-01',
      targetAmount: 800000,
      termsAccepted: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Saved payment method is required for auto debit',
            path: ['savedPaymentMethodId'],
          }),
          expect.objectContaining({
            message: 'Auto-debit consent is required',
            path: ['autoDebitAuthorized'],
          }),
        ])
      );
    }
  });

  it('parses auto debit goal creation with saved method and consent', () => {
    const result = customerSavingsCreateGoalSchema.parse({
      autoDebitAuthorized: true,
      contributionAmount: 20000,
      contributionFrequency: 'weekly',
      maturityDate: '2026-08-01',
      merchantId: VALID_MERCHANT_ID,
      nonWithdrawableAccepted: true,
      productId: VALID_PRODUCT_ID,
      savedPaymentMethodId: VALID_PAYMENT_METHOD_ID,
      sourceMode: 'auto_debit',
      startDate: '2026-06-01',
      targetAmount: 800000,
      termsAccepted: true,
    });

    expect(result.savedPaymentMethodId).toBe(VALID_PAYMENT_METHOD_ID);
    expect(result.autoDebitAuthorized).toBe(true);
    expect(result.sourceMode).toBe('auto_debit');
  });

  it('rejects maturity dates before start dates', () => {
    const result = customerSavingsCreateGoalSchema.safeParse({
      contributionAmount: 20000,
      contributionFrequency: 'daily',
      maturityDate: '2026-05-01',
      merchantSlug: 'ogabassey',
      nonWithdrawableAccepted: true,
      productId: VALID_PRODUCT_ID,
      sourceMode: 'manual',
      startDate: '2026-06-01',
      targetAmount: 800000,
      termsAccepted: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Maturity date cannot be before start date',
            path: ['maturityDate'],
          }),
        ])
      );
    }
  });

  it('rejects invalid calendar dates even when the shape is YYYY-MM-DD', () => {
    const result = customerSavingsCreateGoalSchema.safeParse({
      contributionAmount: 20000,
      contributionFrequency: 'daily',
      maturityDate: '2026-02-31',
      merchantSlug: 'ogabassey',
      nonWithdrawableAccepted: true,
      productId: VALID_PRODUCT_ID,
      sourceMode: 'manual',
      startDate: '2026-02-01',
      targetAmount: 800000,
      termsAccepted: true,
    });

    expect(result.success).toBe(false);
  });

  it('rejects break fees above one hundred percent', () => {
    const result = customerSavingsCreateGoalSchema.safeParse({
      breakFeePercent: 101,
      contributionAmount: 20000,
      contributionFrequency: 'daily',
      maturityDate: '2026-07-01',
      merchantSlug: 'ogabassey',
      nonWithdrawableAccepted: true,
      productId: VALID_PRODUCT_ID,
      sourceMode: 'manual',
      startDate: '2026-06-01',
      targetAmount: 800000,
      termsAccepted: true,
    });

    expect(result.success).toBe(false);
  });

  it('rejects initial contributions above the target amount', () => {
    const result = customerSavingsCreateGoalSchema.safeParse({
      contributionAmount: 20000,
      contributionFrequency: 'daily',
      initialContributionAmount: 900000,
      maturityDate: '2026-07-01',
      merchantSlug: 'ogabassey',
      nonWithdrawableAccepted: true,
      productId: VALID_PRODUCT_ID,
      sourceMode: 'manual',
      startDate: '2026-06-01',
      targetAmount: 800000,
      termsAccepted: true,
    });

    expect(result.success).toBe(false);
  });

  it('trims optional strings and ids in goal creation payloads', () => {
    const result = customerSavingsCreateGoalSchema.parse({
      contributionAmount: 20000,
      contributionFrequency: 'daily',
      initialContributionIdempotencyKey: '  idem-1  ',
      maturityDate: '2026-07-01',
      merchantSlug: '  ogabassey  ',
      nonWithdrawableAccepted: true,
      productId: VALID_PRODUCT_ID,
      sourceMode: 'manual',
      startDate: '2026-06-01',
      targetAmount: 800000,
      termsAccepted: true,
      title: '  iPhone savings  ',
    });

    expect(result.merchantSlug).toBe('ogabassey');
    expect(result.initialContributionIdempotencyKey).toBe('idem-1');
    expect(result.title).toBe('iPhone savings');
  });

  it('accepts an optional goal idempotency key and drops blanks', () => {
    const base = {
      contributionAmount: 20000,
      contributionFrequency: 'daily',
      maturityDate: '2026-07-01',
      merchantSlug: 'ogabassey',
      nonWithdrawableAccepted: true,
      productId: VALID_PRODUCT_ID,
      sourceMode: 'manual',
      startDate: '2026-06-01',
      targetAmount: 800000,
      termsAccepted: true,
    } as const;

    expect(
      customerSavingsCreateGoalSchema.parse({
        ...base,
        goalIdempotencyKey: '  goal-key-1  ',
      }).goalIdempotencyKey
    ).toBe('goal-key-1');
    expect(
      customerSavingsCreateGoalSchema.parse(base).goalIdempotencyKey
    ).toBeUndefined();
    expect(
      customerSavingsCreateGoalSchema.parse({
        ...base,
        goalIdempotencyKey: '   ',
      }).goalIdempotencyKey
    ).toBeUndefined();
  });

  it('requires idempotency key for manual contributions', () => {
    const result = customerSavingsManualContributionSchema.safeParse({
      amount: 20000,
      goalId: VALID_GOAL_ID,
      merchantSlug: 'ogabassey',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'idempotencyKey is required',
            path: ['idempotencyKey'],
          }),
        ])
      );
    }
  });

  it('parses manual contribution payload with valid idempotency key', () => {
    const result = customerSavingsManualContributionSchema.parse({
      amount: 15000,
      goalId: VALID_GOAL_ID,
      idempotencyKey: 'savings-contrib-001',
      merchantSlug: 'ogabassey',
    });

    expect(result).toEqual({
      amount: 15000,
      goalId: VALID_GOAL_ID,
      idempotencyKey: 'savings-contrib-001',
      merchantSlug: 'ogabassey',
    });
  });

  it('parses savings goal action payload', () => {
    const result = customerSavingsGoalActionSchema.parse({
      goalId: VALID_GOAL_ID,
      merchantId: VALID_MERCHANT_ID,
    });

    expect(result).toEqual({
      goalId: VALID_GOAL_ID,
      merchantId: VALID_MERCHANT_ID,
    });
  });

  it('parses auto-debit authorization payload defaults', () => {
    const result = customerSavingsAutoDebitAuthorizeSchema.parse({
      merchantSlug: 'ogabassey',
    });

    expect(result).toEqual({
      amount: 100,
      merchantSlug: 'ogabassey',
    });
  });

  it('parses auto-debit authorization confirmation input', () => {
    const result = customerSavingsAuthorizationConfirmSchema.parse({
      merchantSlug: 'ogabassey',
      reference: 'SAV-AUTH-123',
    });

    expect(result).toEqual({
      merchantSlug: 'ogabassey',
      reference: 'SAV-AUTH-123',
    });
  });
});
