import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const paidOrderAmendmentStatusSchema = z.object({
  state: z.enum([
    'awaiting_payment',
    'awaiting_refund',
    'settled',
    'reversed',
    'cancelled_for_recovery',
  ]),
  holdFulfillment: z.boolean(),
  balanceDueMinor: z.number().int().nonnegative(),
  refundOwedMinor: z.number().int().nonnegative(),
  documentId: z.uuid().nullable(),
  documentNumber: z.number().int().positive().nullable(),
});

export type PaidOrderAmendmentStatus = z.infer<
  typeof paidOrderAmendmentStatusSchema
>;

export const paidOrderDocumentVersionSchema = z.union([
  z.enum(['original', 'current']),
  z.uuid(),
]);
export type PaidOrderDocumentVersion = z.infer<
  typeof paidOrderDocumentVersionSchema
>;

const projectionSchema = z.object({
  inputs: z.object({
    order: z.record(z.string(), z.unknown()),
    items: z.array(z.record(z.string(), z.unknown())),
    payments: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  amendment: paidOrderAmendmentStatusSchema.nullable(),
  documentNumber: z.number().int().positive().nullable(),
});

export async function loadPaidOrderDocument(
  client: Pick<SupabaseClient, 'rpc'>,
  orderId: string,
  version: PaidOrderDocumentVersion | 'live'
) {
  const { data, error } = await client.rpc(
    'read_paid_order_amendment_document',
    {
      p_order_id: orderId,
      p_version: version,
    }
  );
  if (error)
    return {
      data: null,
      error:
        error.code === 'P0002'
          ? ('not_found' as const)
          : ('unavailable' as const),
    };
  if (data === null) return { data: null, error: null };
  const parsed = projectionSchema.safeParse(data);
  return parsed.success
    ? { data: parsed.data, error: null }
    : { data: null, error: 'unavailable' as const };
}

export async function loadTrackingAmendment(
  client: Pick<SupabaseClient, 'rpc'>,
  orderId: string,
  merchantSlug: string,
  token: string | null,
  email: string | null
) {
  const { data, error } = await client.rpc(
    'read_paid_order_amendment_tracking',
    {
      p_order_id: orderId,
      p_merchant_slug: merchantSlug,
      p_tracking_token: token,
      p_email: email,
    }
  );
  if (error) return null;
  const state = paidOrderAmendmentStatusSchema.safeParse(data);
  if (!state.success) return null;
  const projection = z
    .object({
      order: z.object({
        total: z.number(),
        subtotal: z.number(),
        amount_paid: z.number(),
        payment_status: z.string(),
        shipping_status: z.string(),
        updated_at: z.string(),
        paid_at: z.string().nullable(),
        shipped_at: z.string().nullable(),
        delivered_at: z.string().nullable(),
        cancelled_at: z.string().nullable(),
      }),
      items: z.array(z.record(z.string(), z.unknown())),
    })
    .safeParse(data);
  return projection.success
    ? { amendment: state.data, projection: projection.data }
    : null;
}
