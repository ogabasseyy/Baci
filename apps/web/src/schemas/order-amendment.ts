import { z } from 'zod';

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

export const amendmentConfirmSchema = z.strictObject({
  customerAgreed: z.literal(true),
  idempotencyKey: z.string().trim().min(8).max(128),
  previewId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  supportReference: z.string().trim().min(1).max(200).optional(),
});

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
    action: z.literal(['reverse', 'cancel_for_recovery']),
    idempotencyKey,
    reason,
  }),
]);
