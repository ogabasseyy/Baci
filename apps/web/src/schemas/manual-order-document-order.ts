import { z } from 'zod';

const number = z.coerce.number().finite().nonnegative();
const nullableText = z.string().nullable();

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
  currency: z.string().nullish(),
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
  order_items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      quantity: number.positive(),
      price: number,
      variant_name: nullableText,
      condition: nullableText,
    })
  ),
});
