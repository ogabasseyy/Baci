import { z } from 'zod';

const moneySchema = z.number().finite().nonnegative();
const countSchema = z.number().int().nonnegative();

export const adminReconciliationRpcSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  generatedAt: z.string().datetime({ offset: true }),
  items: z.array(
    z
      .object({
        amount: moneySchema.nullable(),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .nullable(),
        id: z.string().uuid(),
        issueType: z.string().nullable(),
        lane: z.enum([
          'platform_settlement',
          'direct_settlement',
          'payout_request',
          'refund',
          'review',
        ]),
        merchantId: z.string().uuid().nullable(),
        merchantName: z.string(),
        occurredAt: z.string().datetime({ offset: true }),
        provider: z.string(),
        status: z.string(),
      })
      .superRefine((item, context) => {
        const isSettlement =
          item.lane === 'platform_settlement' ||
          item.lane === 'direct_settlement';

        if (isSettlement && (item.amount !== null || item.currency !== null)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Settlement activity must not expose money without currency evidence.',
          });
        }
        if (item.amount === null && item.currency !== null) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'A missing amount must not retain a currency label.',
          });
        }
      })
  ),
  metrics: z.object({
    capturedPayments: moneySchema,
    directSettlements: z.object({ amount: z.null(), count: countSchema }),
    openReviews: countSchema,
    paidOrderGmv: moneySchema,
    platformSettlements: z.object({
      failedAmount: z.null(),
      failedCount: countSchema,
      pendingAmount: z.null(),
      pendingCount: countSchema,
      settledAmount: z.null(),
      settledCount: countSchema,
    }),
    payoutRequests: z.object({
      completedAmount: moneySchema,
      completedCount: countSchema,
      failedAmount: moneySchema,
      failedCount: countSchema,
      pendingAmount: moneySchema,
      pendingCount: countSchema,
    }),
    refunds: z.object({
      pendingAmount: moneySchema,
      pendingCount: countSchema,
      refundedAmount: moneySchema,
      refundedCount: countSchema,
    }),
    wallet: z.object({
      availableAmount: moneySchema,
      pendingAmount: moneySchema,
      upcomingAmount: moneySchema,
    }),
  }),
  nextCursor: z
    .object({
      createdAt: z.string().datetime({ offset: true }),
      id: z.string().uuid(),
    })
    .nullable(),
  periodStart: z.string().datetime({ offset: true }),
  reviewScope: z.literal('all_unresolved'),
  supportedCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)),
});

export type AdminReconciliationData = z.infer<
  typeof adminReconciliationRpcSchema
>;
