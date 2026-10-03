import { z } from 'zod';

// Database NULLs must fail closed, never coerce to zero: z.coerce.number()
// turns null into 0, which would advertise money the claim RPC rejects and
// loop the dispatch marker stale (SQL null is distinct from coerced zero).
// Staff set the value and the order triggers re-arm the document.
const number = z.preprocess(
  (value) => (value === null ? Number.NaN : value),
  z.coerce.number().finite().nonnegative()
);
const positiveNumber = z.preprocess(
  (value) => (value === null ? Number.NaN : value),
  z.coerce.number().finite().positive()
);
const nullableText = z.string().nullable();

const manualDocumentOrderItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: positiveNumber,
  price: number,
  variant_name: nullableText,
  condition: nullableText,
  item_description: nullableText,
  assurance_fee: number.nullish(),
  line_id: number.nullish(),
  unit_code: z.string().nullish(),
  line_extension_amount: number.nullish(),
  vat_category_code: z.string().nullish(),
  vat_rate: number.nullish(),
  vat_amount: number.nullish(),
  sellers_item_id: z.string().nullish(),
});

export const manualDocumentOrderSchema = z.object({
  id: z.string(),
  merchant_id: z.string(),
  customer_id: nullableText,
  recorded_by_user_id: nullableText,
  import_job_id: nullableText,
  external_source: nullableText,
  order_number: z.string(),
  created_at: z.string(),
  transaction_date: nullableText,
  invoice_issue_date: nullableText,
  // Strictly a 3-letter code on the raw value (no trim/normalize): the
  // dispatch marker compares the raw column, so normalizing here would loop
  // it stale, while Intl throws on anything downstream that is not an
  // exact code. Invalid values fail closed and re-arm on correction.
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'Invalid currency code')
    .nullish(),
  total: number,
  subtotal: number,
  shipping_fee: number,
  tax_amount: number,
  discount_amount: number,
  amount_paid: number,
  payment_status: z.string(),
  payment_method: nullableText,
  shipping_status: z.string(),
  // Nullable: staff-recorded orders may omit the name, and the enqueue
  // trigger never requires it. The sender falls back to a display name so a
  // missing name sends instead of throwing through every retry.
  customer_name: nullableText,
  customer_email: nullableText,
  customer_phone: nullableText,
  invoice_type_code: nullableText,
  invoice_note: z.string().nullish(),
  payment_due_date: nullableText,
  payment_terms: nullableText,
  buyer_reference: nullableText,
  firs_irn: nullableText,
  firs_csid: nullableText,
  notes: z.string().nullish(),
  shipping_address: z
    .object({
      address: z.string().optional(),
      address_line1: z.string().optional(),
      address_line2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postal_code: z.string().optional(),
      // Mobile staff app persists camelCase; the PDF builder normalizes it.
      postalCode: z.string().optional(),
      country: z.string().optional(),
      // Passthrough: the dispatch marker compares the stored address key
      // set exactly, so unknown keys must survive parsing.
    })
    .passthrough()
    .nullable(),
  order_items: z.array(manualDocumentOrderItemSchema),
});

// The archive/download predicate validates through the sender's own content
// schemas, so the storefront can never advertise a document the sender
// terminally skips as order_validation_failed: the money breakdown plus
// per-item validity over non-empty items. Only the fallible fields are
// picked (ids are uuid-typed, the rest unvalidated-nullable), and unknown
// shapes fail closed via safeParse.
const manualDocumentArchiveMoneySchema = manualDocumentOrderSchema.pick({
  amount_paid: true,
  currency: true,
  discount_amount: true,
  shipping_fee: true,
  subtotal: true,
  tax_amount: true,
  total: true,
});
const manualDocumentArchiveItemSchema = manualDocumentOrderItemSchema.pick({
  name: true,
  price: true,
  quantity: true,
});

export interface ManualDocumentArchiveMoney {
  total?: number | string | null;
  subtotal?: number | string | null;
  shipping_fee?: number | string | null;
  tax_amount?: number | string | null;
  discount_amount?: number | string | null;
  amount_paid?: number | string | null;
  currency?: string | null;
}

export interface ManualDocumentArchiveItem {
  name?: unknown;
  price?: unknown;
  quantity?: unknown;
}

export function isManualOrderDocumentContentValid(
  order: unknown,
  items: unknown
): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  return (
    manualDocumentArchiveMoneySchema.safeParse(order).success &&
    z.array(manualDocumentArchiveItemSchema).safeParse(items).success
  );
}
