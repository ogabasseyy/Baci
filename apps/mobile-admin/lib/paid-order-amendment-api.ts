import { staffTopUpSchema } from '@baci/shared';
import { z } from 'zod';
import { createAuthenticatedFetchText } from '@/hooks/orders/authenticated-fetch';
import { BASE_URL } from '@/lib/api-base-url';

const replacementKind = z.enum(['product', 'variant', 'condition_offer']);
const moneyMinor = z.number().int().safe();
const state = z.enum([
  'awaiting_payment',
  'awaiting_refund',
  'settled',
  'reversed',
  'cancelled_for_recovery',
]);

const workspaceSchema = z.object({
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
      type: z.string(),
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
const replacementsSchema = z.array(
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
const previewSchema = z.object({
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
export type AmendmentConfirmation = z.infer<typeof amendmentConfirmationSchema>;
export type AmendmentPreview = z.infer<typeof previewSchema>;
export type AmendmentWorkspace = z.infer<typeof workspaceSchema>;
export type AmendmentReplacement = z.infer<typeof replacementsSchema>[number];

export class PaidOrderAmendmentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

async function request<T>(
  orderId: string,
  suffix: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const { response, text } = await createAuthenticatedFetchText(
    `${BASE_URL}/api/orders/${encodeURIComponent(orderId)}/amendments${suffix}`,
    {
      method: body ? 'POST' : 'GET',
      ...(body
        ? {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
          }
        : {}),
      signal,
    },
    15_000
  );
  const data: unknown = JSON.parse(text);
  if (!response.ok) {
    const error = z
      .object({ error: z.string(), code: z.string().optional() })
      .safeParse(data);
    throw new PaidOrderAmendmentError(
      error.data?.error ?? 'Unable to load the order change.',
      response.status,
      error.data?.code
    );
  }
  return schema.parse(data);
}

export const paidOrderAmendment = {
  workspace(orderId: string, signal?: AbortSignal) {
    return request(orderId, '', workspaceSchema, undefined, signal);
  },
  search(orderId: string, lineId: string, search: string) {
    const query = new URLSearchParams({ lineId, search });
    return request(orderId, `?${query.toString()}`, replacementsSchema);
  },
  preview(orderId: string, lineId: string, { id, kind }: AmendmentReplacement) {
    return request(orderId, '/preview', previewSchema, {
      lineId,
      replacement: { id, kind },
    });
  },
  finance(
    orderId: string,
    amendmentId: string,
    payload: VerifiedSettlementAction
  ) {
    return request(
      orderId,
      `/${encodeURIComponent(amendmentId)}/actions`,
      z.object({ amendmentId: z.uuid() }),
      payload
    );
  },
  confirm(orderId: string, payload: AmendmentConfirmation) {
    return request(orderId, '', z.object({ amendmentId: z.uuid() }), payload);
  },
};
