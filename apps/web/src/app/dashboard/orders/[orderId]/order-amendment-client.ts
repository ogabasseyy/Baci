import { z } from 'zod';
import { fetchWithCsrf } from '@/lib/api-client';
import { paidOrderAmendmentStatusSchema } from '@/lib/orders/paid-order-amendment-document';

export const workspaceSchema = z.object({
  canStart: z.boolean(),
  confirmationKey: z.string().nullish(),
  canEdit: z.boolean(),
  canRefund: z.boolean(),
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
});

export class AmendmentRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number
  ) {
    super(message);
  }
}

export async function requestAmendment(
  path: string,
  body?: unknown,
  signal?: AbortSignal
) {
  const response =
    body === undefined
      ? await fetch(path, { cache: 'no-store', signal })
      : await fetchWithCsrf(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
  const data: unknown = await response.json();
  if (!response.ok) {
    const parsed = z
      .object({ error: z.string(), code: z.string().optional() })
      .safeParse(data);
    throw new AmendmentRequestError(
      parsed.data?.error ?? 'Unable to load the order change.',
      parsed.data?.code,
      response.status
    );
  }
  return data;
}
