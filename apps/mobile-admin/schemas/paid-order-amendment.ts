import { staffTopUpSchema } from '@baci/shared';
import { z } from 'zod';

const replacementKind = z.enum(['product', 'variant', 'condition_offer']);
const moneyMinor = z.number().int().safe();
const state = z.enum([
  'awaiting_payment',
  'awaiting_refund',
  'settled',
  'reversed',
  'cancelled_for_recovery',
]);

export const workspaceSchema = z.object({
  canStart: z.boolean(),
  canRefund: z.boolean(),
  isVerifiedFunding: z.boolean().optional(),
  verifiedCreditDirectRefund: z.boolean().nullish(),
  canOpenVerifiedCancellation: z.boolean().nullish(),
  verifiedCancellationPending: z.boolean().nullish(),
  verifiedCancellationReady: z.boolean().nullish(),
  confirmationKey: z.string().nullish(),
  summary: z.object({ amendmentId: z.uuid() }).nullable(),
  events: z.array(
    z.object({
      id: z.number().int(),
      type: z.string(),
      createdAt: z.iso.datetime({ offset: true }),
      details: z.record(z.string(), z.unknown()),
    })
  ),
  bankEvidence: z.array(
    z.object({
      id: z.uuid(),
      amountMinor: moneyMinor,
      status: z.string().nullable(),
      transactionId: z.uuid().nullable(),
      occurredAt: z.iso.datetime({ offset: true }),
      method: z.string().optional(),
    })
  ),
  customer: z
    .object({
      state,
      balanceDueMinor: moneyMinor,
      refundOwedMinor: moneyMinor,
    })
    .nullable(),
});
export const replacementsSchema = z.array(
  z.object({
    id: z.uuid(),
    kind: replacementKind,
    label: z.string(),
  })
);
const lineSchema = z.object({
  name: z.string(),
  variantName: z.string().nullish(),
  condition: z.string().nullish(),
  quantity: z.number().int().positive(),
});
export const previewSchema = z.object({
  previewId: z.uuid(),
  beforeLine: lineSchema,
  afterLine: lineSchema,
  beforeTotalMinor: moneyMinor,
  afterTotalMinor: moneyMinor,
  adjustmentMinor: moneyMinor,
  canRecordStaffTopUp: z.boolean().optional(),
  bankEvidence: z
    .array(
      z.object({
        id: z.uuid(),
        amountMinor: moneyMinor,
        method: z.enum(['bank_transfer', 'cash', 'pos']).optional(),
        occurredAt: z.iso.datetime({ offset: true }),
      })
    )
    .optional(),
});

export const amendmentConfirmationSchema = z
  .object({
    previewId: z.uuid(),
    idempotencyKey: z.uuid(),
    reason: z.string().trim().min(1).max(500),
    customerAgreed: z.literal(true),
    bankEvidenceId: z.uuid().optional(),
    staffTopUp: staffTopUpSchema.optional(),
  })
  .refine((value) => !(value.bankEvidenceId && value.staffTopUp));
export const verifiedSettlementActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('record_verified_lender_refund'),
    idempotencyKey: z.uuid(),
  }),
  z.object({
    action: z.literal('claim_offline_disbursement'),
    idempotencyKey: z.uuid(),
    sourceKind: z.literal('unapplied'),
    sourceId: z.uuid(),
  }),
  z.object({
    action: z.literal('record_offline_refund'),
    idempotencyKey: z.uuid(),
    claimId: z.uuid(),
    evidenceId: z.uuid(),
  }),
  z.object({
    action: z.literal([
      'open_verified_cancellation',
      'cancel_with_verified_refunds',
    ]),
    idempotencyKey: z.uuid(),
    reason: z.string().trim().min(1).max(500),
  }),
]);
export type VerifiedSettlementAction = z.infer<
  typeof verifiedSettlementActionSchema
>;
export const claimResultSchema = z.object({
  claimId: z.uuid(),
  amountMinor: moneyMinor,
  currency: z.literal('NGN'),
});
export const verifiedReturnResultSchema = z.object({
  claimId: z.uuid(),
  outcome: z.literal('verified'),
  transactionId: z.uuid().nullable(),
});
export const amendmentResultSchema = z.object({ amendmentId: z.uuid() });
export type FinanceActionResult =
  | z.infer<typeof claimResultSchema>
  | z.infer<typeof verifiedReturnResultSchema>
  | z.infer<typeof amendmentResultSchema>;
export type AmendmentConfirmation = z.infer<typeof amendmentConfirmationSchema>;
export type AmendmentPreview = z.infer<typeof previewSchema>;
export type AmendmentWorkspace = z.infer<typeof workspaceSchema>;
export type AmendmentReplacement = z.infer<typeof replacementsSchema>[number];

export const amendmentApiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});
export const confirmationResultSchema = z.object({ amendmentId: z.uuid() });
