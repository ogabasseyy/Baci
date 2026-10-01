import { z } from 'zod';

const optionalUuidSchema = z
  .string()
  .uuid('Merchant filter must be a valid ID.')
  .optional();

const optionalDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Cursor timestamp must be an ISO date.' })
  .optional();

export const reconciliationPeriodSchema = z.enum(['7d', '30d', '90d', 'all']);
export const reconciliationLaneSchema = z.enum([
  'all',
  'platform_settlement',
  'direct_settlement',
  'payout_request',
  'refund',
  'review',
]);
export const reconciliationStatusSchema = z.enum([
  'all',
  'pending',
  'processing',
  'settled',
  'failed',
  'completed',
  'refunded',
  'refund_pending',
  'open',
  'direct',
]);

export const adminReconciliationQuerySchema = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter uppercase code.')
      .refine((currency) => currency !== 'UNK', {
        message: 'Unknown settlement currency cannot be used for money totals.',
      }),
    cursorAt: optionalDateTimeSchema,
    cursorId: optionalUuidSchema,
    format: z.enum(['json', 'csv']).optional().default('json'),
    lane: reconciliationLaneSchema.optional().default('all'),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    merchantId: optionalUuidSchema,
    period: reconciliationPeriodSchema.optional().default('30d'),
    status: reconciliationStatusSchema.optional().default('all'),
  })
  .superRefine((value, context) => {
    if (Boolean(value.cursorAt) !== Boolean(value.cursorId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Both cursor fields are required together.',
        path: value.cursorAt ? ['cursorId'] : ['cursorAt'],
      });
    }
  });

export type AdminReconciliationQuery = z.infer<
  typeof adminReconciliationQuerySchema
>;
