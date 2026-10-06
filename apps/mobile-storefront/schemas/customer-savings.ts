import { z } from 'zod';

const SavingsFrequencySchema = z.enum(['daily', 'weekly', 'monthly']);
const SavingsGoalStatusSchema = z.enum([
  'active',
  'paused',
  'completed',
  'cancelled',
  'spent',
]);
const PAYMENT_PROVIDERS = ['paystack'] as const;

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

const PaymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
const IsoDateSchema = z
  .string()
  .trim()
  .refine(isValidIsoDate, 'Date must be in YYYY-MM-DD format');
// Balances are naira with kobo precision: the ledger stores numeric(12, 2),
// so a 101-kobo transfer lands as 1.01. Integer-only parsing would reject
// the entire goals response for that customer.
function hasKoboPrecision(value: number) {
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}
const PositiveAmountSchema = z
  .number()
  .finite()
  .positive()
  .refine(hasKoboPrecision, 'Amount must have at most two decimal places');
const NonNegativeAmountSchema = z
  .number()
  .finite()
  .min(0)
  .refine(hasKoboPrecision, 'Amount must have at most two decimal places');

export const SavingsGoalSummarySchema = z.object({
  contributionAmount: PositiveAmountSchema.optional(),
  contributionFrequency: SavingsFrequencySchema.optional(),
  currentAmount: NonNegativeAmountSchema,
  goalId: z.string(),
  goalStatus: SavingsGoalStatusSchema,
  success: z.boolean(),
  walletBalance: NonNegativeAmountSchema,
});

export const SavingsGoalSchema = z.object({
  breakFeePercent: z.number().finite().min(0).max(100),
  contributionAmount: PositiveAmountSchema,
  contributionFrequency: SavingsFrequencySchema,
  currentAmount: NonNegativeAmountSchema,
  id: z.string(),
  maturityDate: IsoDateSchema,
  productId: z.string(),
  sourceMode: z.enum(['manual', 'auto_debit']),
  startDate: IsoDateSchema,
  status: SavingsGoalStatusSchema,
  targetAmount: PositiveAmountSchema,
  title: z.string(),
  variantId: z.string().nullable(),
});

export const ListSavingsGoalsResponseSchema = z.object({
  goals: z.array(SavingsGoalSchema),
  summary: z.object({
    activeGoalCount: z.number().finite().int().min(0),
    savingsBalance: NonNegativeAmountSchema,
  }),
});

export const SavingsContributionResponseSchema = z.object({
  contributionId: z.string(),
  goalCurrentAmount: NonNegativeAmountSchema,
  goalStatus: SavingsGoalStatusSchema,
  success: z.boolean(),
  walletBalance: NonNegativeAmountSchema,
  walletTransactionId: z.string().nullable(),
});

export const SavingsGoalActionResponseSchema = z.object({
  goalStatus: SavingsGoalStatusSchema,
  success: z.boolean(),
});

export const SavingsDeviceSwapResponseSchema = z.object({
  currentAmount: NonNegativeAmountSchema,
  goalId: z.string(),
  goalStatus: SavingsGoalStatusSchema,
  success: z.boolean(),
  targetAmount: PositiveAmountSchema,
});

export const SavingsVariantResolutionResponseSchema = z.object({
  goalId: z.string(),
  goalStatus: z.literal('completed'),
  success: z.literal(true),
});

export const SavingsAuthorizationResponseSchema = z.object({
  authorization_url: z.url(),
  checkout_url: z.url(),
  gateway: PaymentProviderSchema,
  reference: z.string(),
  success: z.literal(true),
});

export const SavingsAuthorizationConfirmationResponseSchema =
  z.discriminatedUnion('status', [
    z.object({
      reference: z.string(),
      status: z.literal('processing'),
    }),
    z.object({
      reference: z.string(),
      savedPaymentMethodId: z.string(),
      status: z.literal('successful'),
      success: z.literal(true),
    }),
  ]);

export const CustomerPaymentMethodSchema = z.object({
  bank: z.string().nullable(),
  brand: z.string().nullable(),
  exp_month: z.string().nullable(),
  exp_year: z.string().nullable(),
  id: z.string(),
  is_default: z.boolean(),
  label: z.string(),
  last4: z.string().nullable(),
  provider: PaymentProviderSchema,
});

export const CustomerPaymentMethodsResponseSchema = z.object({
  methods: z.array(CustomerPaymentMethodSchema),
});

export type CustomerPaymentMethod = z.infer<typeof CustomerPaymentMethodSchema>;
export type SavingsGoal = z.infer<typeof SavingsGoalSchema>;

export const SavingsPlanFundingAccountSchema = z.object({
  accountName: z.string().min(1),
  accountNumber: z.string().min(1),
  bankName: z.string().min(1),
});

export const SavingsPlanFundingResponseSchema = z.object({
  accounts: z.array(SavingsPlanFundingAccountSchema).max(32).optional(),
  code: z.string().min(1).max(64).optional(),
  status: z.enum(['ready', 'pending', 'unavailable']),
});

export type SavingsPlanFundingAccount = z.infer<
  typeof SavingsPlanFundingAccountSchema
>;
export type SavingsPlanFundingResponse = z.infer<
  typeof SavingsPlanFundingResponseSchema
>;
