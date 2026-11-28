import type { z } from 'zod';
import {
  type AmendmentConfirmation,
  type AmendmentReplacement,
  amendmentApiErrorSchema,
  amendmentResultSchema,
  claimResultSchema,
  confirmationResultSchema,
  type FinanceActionResult,
  previewSchema,
  replacementsSchema,
  type VerifiedSettlementAction,
  verifiedReturnResultSchema,
  workspaceSchema,
} from '@/schemas/paid-order-amendment';

export type {
  AmendmentConfirmation,
  AmendmentPreview,
  AmendmentReplacement,
  AmendmentWorkspace,
  VerifiedSettlementAction,
} from '@/schemas/paid-order-amendment';
export {
  amendmentConfirmationSchema,
  verifiedSettlementActionSchema,
} from '@/schemas/paid-order-amendment';

import { createAuthenticatedFetchText } from '@/hooks/orders/authenticated-fetch';
import { BASE_URL } from '@/lib/api-base-url';

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
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PaidOrderAmendmentError(
      'Unable to load the order change.',
      response.status
    );
  }
  if (!response.ok) {
    const error = amendmentApiErrorSchema.safeParse(data);
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
    const responseSchema =
      payload.action === 'claim_offline_disbursement'
        ? claimResultSchema
        : payload.action === 'record_offline_refund'
          ? verifiedReturnResultSchema
          : amendmentResultSchema;
    return request(
      orderId,
      `/${encodeURIComponent(amendmentId)}/actions`,
      responseSchema as z.ZodType<FinanceActionResult>,
      payload
    );
  },
  confirm(orderId: string, payload: AmendmentConfirmation) {
    return request(orderId, '', confirmationResultSchema, payload);
  },
};
