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
  customer_name: z.string(),
  customer_email: nullableText,
  customer_phone: nullableText,
  invoice_type_code: nullableText,
  shipping_address: z
    .object({
      address: z.string().optional(),
      address_line1: z.string().optional(),
      address_line2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postal_code: z.string().optional(),
      country: z.string().optional(),
    })
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

export const manualDocumentMerchantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  business_name: nullableText,
  custom_domain: nullableText,
  email_sender_name: nullableText,
  logo_url: nullableText,
  email: z.string(),
  phone: nullableText,
  support_email: nullableText,
  support_phone: nullableText,
  business_address: nullableText,
  cac_rc_number: nullableText,
  tax_identification_number: nullableText,
  legal_entity_name: nullableText,
  vat_registration_status: nullableText,
  vat_rate: number.nullable(),
  bank_code: nullableText,
  bank_account_number: nullableText,
  bank_name: nullableText,
  bank_account_name: nullableText,
  brand_colors: z
    .object({ primary: z.string(), background: z.string(), accent: z.string() })
    .nullable(),
});

export const manualDocumentClaimSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('created'),
    claim_id: z.string().min(1),
    customer_id: z.string().min(1),
    customer_email: z.string().min(1),
  }),
  z.object({ status: z.literal('skipped') }),
]);
