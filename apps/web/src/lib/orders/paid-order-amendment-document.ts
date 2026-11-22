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

const money = z.number().nullish();
const text = z.string().nullish();
const documentOrderSchema = z.object({
  order_number: text,
  currency: text,
  total: money,
  subtotal: money,
  amount_paid: money,
  payment_status: text,
  created_at: text,
  updated_at: text,
  shipping_status: text,
  paid_at: text,
  shipped_at: text,
  delivered_at: text,
  cancelled_at: text,
  transaction_date: text,
  invoice_issue_date: text,
  tax_point_date: text,
  invoice_type_code: text,
  customer_name: text,
  customer_email: text,
  customer_phone: text,
  shipping_address: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .nullish(),
  tax_amount: money,
  shipping_fee: money,
  discount_amount: money,
  tax_exclusive_amount: money,
  tax_inclusive_amount: money,
  invoice_note: text,
  buyer_reference: text,
  purchase_order_reference: text,
  payment_terms: text,
  payment_due_date: text,
  notes: text,
  fulfillment_details: z.record(z.string(), z.unknown()).nullish(),
});

const projectionSchema = z.object({
  inputs: z.object({
    order: documentOrderSchema,
    items: z.array(z.record(z.string(), z.unknown())),
    payments: z.array(z.record(z.string(), z.unknown())).optional(),
    sellerTax: z
      .object({
        registrationStatus: z.string().nullable(),
        rate: z.number().nullable(),
      })
      .nullish(),
    revisedTaxPinned: z.boolean().optional(),
    taxSubtotals: z
      .array(
        z.object({
          vat_category_code: z.string(),
          vat_rate: z.number(),
          taxable_amount: z.number(),
          tax_amount: z.number(),
          exemption_reason: z.string().nullable(),
        })
      )
      .nullish(),
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
