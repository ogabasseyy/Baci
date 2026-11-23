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
  total: z.number(),
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

export const paidOrderDocumentProjectionSchema = z
  .object({
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
  })
  .refine(
    ({ amendment, inputs }) =>
      amendment === null ||
      (typeof inputs.order.subtotal === 'number' &&
        typeof inputs.order.amount_paid === 'number'),
    'Amended document snapshots require complete monetary totals'
  );

export const paidOrderTrackingProjectionSchema = z.object({
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
});

export const amendmentUpdateDeliverySchema = z.object({
  claim: z.uuid(),
  orderId: z.uuid(),
  merchantId: z.uuid(),
  customerId: z.uuid().nullable(),
  email: z.email(),
  merchantName: z.string(),
  merchantSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  orderNumber: z.string(),
  trackingToken: z.string().nullable(),
  eventType: z.string(),
  status: paidOrderAmendmentStatusSchema,
  documentId: z.uuid(),
});

export type AmendmentUpdateDelivery = z.infer<
  typeof amendmentUpdateDeliverySchema
>;
export const amendmentUpdateEventIdsSchema = z.array(
  z.string().regex(/^[1-9][0-9]*$/)
);
export const amendmentUpdateClaimSchema = z.object({ claim: z.uuid() });
