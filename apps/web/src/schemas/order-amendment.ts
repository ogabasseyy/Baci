import { staffTopUpSchema } from '@baci/shared/schemas';
import { z } from 'zod';
import { paidOrderAmendmentStatusSchema } from './order-amendment-document';

export const amendmentOrderParams = z.object({ id: z.uuid() });

export const amendmentReplacementSearchSchema = z.object({
  lineId: z.uuid(),
  search: z.string().trim().min(2).max(80),
});

export const unamendedOrderSummarySchema = z.object({ summary: z.null() });

export const amendmentPreviewSchema = z.strictObject({
  lineId: z.uuid(),
  replacement: z.strictObject({
    id: z.uuid(),
    kind: z.enum(['product', 'variant', 'condition_offer']),
  }),
});

export const amendmentConfirmSchema = z
  .strictObject({
    bankEvidenceId: z.uuid().optional(),
    customerAgreed: z.literal(true),
    idempotencyKey: z.string().trim().min(8).max(128),
    previewId: z.uuid(),
    reason: z.string().trim().min(1).max(500),
    supportReference: z.string().trim().min(1).max(200).optional(),
    staffTopUp: staffTopUpSchema.optional(),
  })
  .refine((value) => !(value.bankEvidenceId && value.staffTopUp));

export const amendmentActionParams = amendmentOrderParams.extend({
  amendmentId: z.uuid(),
});

const idempotencyKey = z.string().trim().min(8).max(128);
const evidenceId = z.uuid();
const operationId = z.uuid();
const reason = z.string().trim().min(1).max(500);

export const amendmentActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('record_top_up'),
    idempotencyKey,
    evidenceId,
  }),
  z.strictObject({
    action: z.literal('claim_offline_disbursement'),
    idempotencyKey,
    sourceKind: z.enum(['unapplied', 'cancellation_leg']),
    sourceId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal('record_offline_refund'),
    idempotencyKey,
    claimId: z.uuid(),
    evidenceId,
  }),
  z.strictObject({
    action: z.literal([
      'refresh_refund_status',
      'retry_failed_refund',
      'retry_merchant_adjustment',
    ]),
    idempotencyKey,
    operationId,
  }),
  z.strictObject({
    action: z.literal([
      'reverse',
      'cancel_for_recovery',
      'open_verified_cancellation',
      'cancel_with_verified_refunds',
    ]),
    idempotencyKey,
    reason,
  }),
  z.strictObject({
    action: z.literal('record_verified_lender_refund'),
    idempotencyKey,
  }),
]);

export const workspaceSchema = z.object({
  canStart: z.boolean(),
  confirmationKey: z.string().nullish(),
  canEdit: z.boolean(),
  canRefund: z.boolean(),
  isVerifiedFunding: z.boolean().optional(),
  verifiedCreditDirectRefund: z.boolean().nullish(),
  canOpenVerifiedCancellation: z.boolean().nullish(),
  verifiedCancellationPending: z.boolean().nullish(),
  verifiedCancellationReady: z.boolean().nullish(),
  customer: paidOrderAmendmentStatusSchema.nullable(),
  summary: z.object({ amendmentId: z.uuid() }).nullable(),
  events: z.array(
    z.object({
      id: z.number().int(),
      type: z.string(),
      createdAt: z.string(),
      details: z.record(z.string(), z.unknown()),
    })
  ),
  refunds: z.array(
    z.object({
      id: z.uuid(),
      state: z.string(),
      amountMinor: z.number(),
      preflightReview: z.boolean().optional(),
    })
  ),
  bankEvidence: z.array(
    z.object({
      id: z.uuid(),
      amountMinor: z.number(),
      status: z.string().nullable(),
      transactionId: z.uuid().nullable(),
      occurredAt: z.string(),
      method: z.string().optional(),
    })
  ),
});

export const replacementsSchema = z.array(
  z.object({
    id: z.uuid(),
    kind: z.enum(['product', 'variant', 'condition_offer']),
    label: z.string(),
  })
);

const previewLine = z.object({
  name: z.string(),
  condition: z.string().nullish(),
  variantName: z.string().nullish(),
  unitPriceMinor: z.number().int(),
  quantity: z.number().int(),
});
export const amendmentPreviewResult = z.object({
  previewId: z.uuid(),
  expiresAt: z.string(),
  beforeLine: previewLine,
  afterLine: previewLine,
  beforeTotalMinor: z.number().int(),
  afterTotalMinor: z.number().int(),
  adjustmentMinor: z.number().int(),
  canRecordStaffTopUp: z.boolean().optional(),
  bankEvidence: z
    .array(
      z.object({
        id: z.uuid(),
        amountMinor: z.number().int().positive(),
        method: z.enum(['bank_transfer', 'cash', 'pos']).optional(),
        occurredAt: z.string(),
      })
    )
    .optional(),
});

export const amendmentErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});
