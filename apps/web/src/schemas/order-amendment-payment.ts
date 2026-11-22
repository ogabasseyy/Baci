import { z } from 'zod';
import { paystackAmendmentRefundReference } from './paystack-refund-event';

export const paystackAmendmentProviderIdSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/);
export const paystackAmendmentRefundClaimSchema = z.object({
  submit: z.boolean(),
  preflightReview: z.boolean().default(false),
  reference: paystackAmendmentRefundReference,
  captureReference: z.string().min(1),
  captureId: paystackAmendmentProviderIdSchema,
  amountMinor: z.number().int().positive(),
  integrationId: paystackAmendmentProviderIdSchema,
  domain: z.enum(['live', 'test']),
});

export const paystackAmendmentRefundEvidenceSchema = z.object({
  reference: paystackAmendmentRefundReference,
  id: paystackAmendmentProviderIdSchema,
  transaction: z.union([
    paystackAmendmentProviderIdSchema,
    z.object({ id: paystackAmendmentProviderIdSchema }),
  ]),
  integration: paystackAmendmentProviderIdSchema,
  amount: z.number().int().positive(),
  currency: z.literal('NGN'),
  domain: z.enum(['live', 'test']),
  status: z
    .string()
    .transform((value) => value.replace('-', '_'))
    .pipe(
      z.enum([
        'pending',
        'processing',
        'needs_attention',
        'failed',
        'processed',
      ])
    ),
});

export const paidOrderCheckoutCaptureDecisionSchema = z.object({
  customerFeeMinor: z.number().int().nonnegative().optional(),
  outcome: z.enum([
    'ready',
    'review',
    'unapplied',
    'awaiting_evidence',
    'original_replay',
  ]),
});

export const amendmentRefundAttemptIdsSchema = z.array(z.uuid());
