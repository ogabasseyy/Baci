import type { z } from 'zod';
import { createAuthenticatedFetch } from '@/hooks/orders/authenticated-fetch';
import { BASE_URL } from '@/lib/api-client';
import {
  giglExternalWaybillErrorSchema,
  giglExternalWaybillLinkResponseSchema,
  giglExternalWaybillPreviewResponseSchema,
} from '@/schemas/gigl-external-waybill';

// The server may log in to GIG (slow when cold) and read two GIG endpoints.
const REQUEST_TIMEOUT_MS = 45_000;

export class GiglExternalWaybillError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'GiglExternalWaybillError';
    this.code = code;
    this.status = status;
  }
}

async function postWaybill<T>(
  orderId: string,
  body: { action: 'preview' | 'link'; waybill: string },
  schema: z.ZodType<T>
): Promise<T> {
  const response = await createAuthenticatedFetch(
    `${BASE_URL}/api/orders/${encodeURIComponent(orderId)}/shipping/gigl-waybill`,
    {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
    REQUEST_TIMEOUT_MS
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = giglExternalWaybillErrorSchema.safeParse(payload);
    throw new GiglExternalWaybillError(
      (error.success && error.data.error) || 'Could not check this waybill.',
      response.status,
      error.success ? error.data.code : undefined
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error('Invalid server response');
  return parsed.data;
}

/** Read-only: asks the server to check the waybill with GIG. */
export async function previewOrderGiglExternalWaybill(
  orderId: string,
  waybill: string
) {
  const { preview } = await postWaybill(
    orderId,
    { action: 'preview', waybill },
    giglExternalWaybillPreviewResponseSchema
  );
  return preview;
}

/** Attaches the waybill; the server re-checks GIG before saving. */
export function linkOrderGiglExternalWaybill(orderId: string, waybill: string) {
  return postWaybill(
    orderId,
    { action: 'link', waybill },
    giglExternalWaybillLinkResponseSchema
  );
}
