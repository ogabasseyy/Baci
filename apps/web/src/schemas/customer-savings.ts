import { z } from 'zod';
import {
  optionalMerchantId,
  optionalNonEmptyString,
  optionalUuid,
  requireMerchantIdentifier,
} from '@/schemas/merchant-identifier';

const merchantIdentifierObjectSchema = z.object({
  merchantId: optionalMerchantId,
  merchantSlug: optionalNonEmptyString,
});

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

const isoDateSchema = z
  .string()
  .trim()
  .refine(isValidIsoDate, 'Date must be in YYYY-MM-DD format');

const preferredDebitTimeSchema = z
  .string()
  .trim()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
    'Preferred debit time must be HH:mm or HH:mm:ss'
  )
  .optional();

const amountSchema = z.coerce
  .number({
    error: 'Amount must be a valid number',
  })
  .finite('Amount cannot be Infinity or NaN')
  .positive('Amount must be greater than zero');

const nonNegativeAmountSchema = z.coerce
  .number({
    error: 'Amount must be a valid number',
  })
  .finite('Amount cannot be Infinity or NaN')
  .min(0, 'Amount cannot be negative');

const customerSavingsMerchantIdentifierSchema =
  merchantIdentifierObjectSchema.superRefine(requireMerchantIdentifier);

export const customerSavingsGoalsQuerySchema =
  customerSavingsMerchantIdentifierSchema;

export const customerPaymentMethodsQuerySchema =
  customerSavingsMerchantIdentifierSchema;

export const customerSavingsCreateGoalSchema = merchantIdentifierObjectSchema
  .extend({
    autoDebitAuthorized: z.boolean().optional(),
    breakFeePercent: nonNegativeAmountSchema
      .max(100, 'Break fee percent cannot exceed 100')
      .optional(),
    contributionAmount: amountSchema,
    contributionFrequency: z.enum(['daily', 'weekly', 'monthly']),
    earlyEndFeeAccepted: z.boolean().optional(),
    goalIdempotencyKey: optionalNonEmptyString,
    initialContributionAmount: nonNegativeAmountSchema.optional().default(0),
    initialContributionIdempotencyKey: optionalNonEmptyString,
    metadata: z.record(z.string(), z.unknown()).optional(),
    maturityDate: isoDateSchema,
    nonWithdrawableAccepted: z.literal(true),
    preferredDebitTime: preferredDebitTimeSchema,
    productId: z.uuid('Product id must be a valid UUID'),
    savedPaymentMethodId: optionalUuid,
    sourceMode: z.enum(['manual', 'auto_debit']),
    startDate: isoDateSchema,
    targetAmount: amountSchema,
    termsAccepted: z.literal(true),
    title: optionalNonEmptyString,
    variantId: optionalUuid,
  })
  .superRefine((data, ctx) => {
    requireMerchantIdentifier(data, ctx);

    if (data.sourceMode === 'auto_debit') {
      if (!data.savedPaymentMethodId) {
        ctx.addIssue({
          code: 'custom',
          message: 'Saved payment method is required for auto debit',
          path: ['savedPaymentMethodId'],
        });
      }

      if (data.autoDebitAuthorized !== true) {
        ctx.addIssue({
          code: 'custom',
          message: 'Auto-debit consent is required',
          path: ['autoDebitAuthorized'],
        });
      }
    }

    if (data.maturityDate < data.startDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'Maturity date cannot be before start date',
        path: ['maturityDate'],
      });
    }

    if (data.initialContributionAmount > data.targetAmount) {
      ctx.addIssue({
        code: 'custom',
        message: 'Initial contribution cannot exceed target amount',
        path: ['initialContributionAmount'],
      });
    }
  });

export const customerSavingsManualContributionSchema =
  merchantIdentifierObjectSchema
    .extend({
      amount: amountSchema,
      description: optionalNonEmptyString,
      goalId: z.uuid('Goal id must be a valid UUID'),
      idempotencyKey: z.preprocess(
        (value) => (typeof value === 'string' ? value : ''),
        z.string().trim().min(1, 'idempotencyKey is required')
      ),
    })
    .superRefine(requireMerchantIdentifier);

export const customerSavingsGoalActionSchema = merchantIdentifierObjectSchema
  .extend({
    goalId: z.uuid('Goal id must be a valid UUID'),
  })
  .superRefine(requireMerchantIdentifier);

export const customerSavingsGoalDeviceSwapSchema =
  merchantIdentifierObjectSchema
    .extend({
      goalId: z.uuid('Goal id must be a valid UUID'),
      productId: z.uuid('Product id must be a valid UUID'),
      variantId: optionalUuid,
    })
    .superRefine(requireMerchantIdentifier);

export const customerSavingsAutoDebitAuthorizeSchema =
  merchantIdentifierObjectSchema
    .extend({
      amount: amountSchema.optional().default(100),
      customerName: optionalNonEmptyString,
      customerPhone: optionalNonEmptyString,
    })
    .superRefine(requireMerchantIdentifier);

export const customerSavingsAuthorizationConfirmSchema =
  merchantIdentifierObjectSchema
    .extend({
      reference: z
        .string()
        .trim()
        .regex(
          /^SAV-AUTH-[A-Z0-9_-]{1,100}$/,
          'Savings authorization reference is invalid'
        ),
    })
    .superRefine(requireMerchantIdentifier);

export type CustomerSavingsCreateGoalInput = z.infer<
  typeof customerSavingsCreateGoalSchema
>;
export type CustomerSavingsGoalDeviceSwapInput = z.infer<
  typeof customerSavingsGoalDeviceSwapSchema
>;
export type CustomerSavingsGoalActionInput = z.infer<
  typeof customerSavingsGoalActionSchema
>;
export type CustomerSavingsManualContributionInput = z.infer<
  typeof customerSavingsManualContributionSchema
>;
