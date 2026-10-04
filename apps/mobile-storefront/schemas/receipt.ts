/**
 * Zod schemas for receipt/invoice data
 *
 * Validates data returned from Supabase queries.
 * Types are inferred from these schemas in types/receipt.ts.
 */

import {
  MANUAL_ORDER_ITEM_FINANCIAL_FIELDS,
  type ManualOrderItemFinancialField,
} from '@baci/shared/receipt';
import { z } from 'zod';

// ============================================
// SHARED SUB-SCHEMAS
// ============================================

// Validated numeric item fields derive from the shared gate field list —
// the same list the web sender/archive schemas build from — so a new
// validated field can never exist on web while mobile silently strips it.
const orderItemFinancialShape: Record<
  ManualOrderItemFinancialField,
  z.ZodOptional<z.ZodNullable<z.ZodNumber>>
> = Object.fromEntries(
  MANUAL_ORDER_ITEM_FINANCIAL_FIELDS.map((field) => [
    field,
    z.number().nullable().optional(),
  ])
) as Record<
  ManualOrderItemFinancialField,
  z.ZodOptional<z.ZodNullable<z.ZodNumber>>
>;
const OrderItemSchema = z.object({
  id: z.string(),
  product_name: z.string(),
  condition: z.string().nullable().optional(),
  variant_name: z.string().nullable().optional(),
  quantity: z.number(),
  price: z.number(),
  image_url: z.string().nullable().optional(),
  ...orderItemFinancialShape,
  unit_code: z.string().nullable().optional(),
  vat_category_code: z.string().nullable().optional(),
  // Rendered description/SKU like the emailed PDF: the detail query
  // selects both so previews never drop lines the attachment shows.
  item_description: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  sellers_item_id: z.string().nullable().optional(),
});

const ShippingAddressSchema = z.object({
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
});

const VirtualAccountSchema = z.object({
  account_number: z.string(),
  bank_name: z.string(),
  account_name: z.string(),
});

const TransactionSchema = z.object({
  amount: z.number(),
  created_at: z.string(),
  description: z.string().nullable(),
  metadata: z.object({ payment_method: z.string().optional() }).nullable(),
  // Provided by the RPC mapper for receipt dating (settled filter).
  gateway: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  transaction_type: z.string().nullable().optional(),
});

// ============================================
// RECEIPT LIST ITEM
// ============================================

export const ReceiptListItemSchema = z.object({
  id: z.string(),
  order_number: z.string(),
  payment_status: z.string(),
  shipping_status: z.string().nullable().optional(),
  total: z.number(),
  subtotal: z.number().nullable().optional(),
  shipping_fee: z.number().nullable().optional(),
  tax_amount: z.number().nullable().optional(),
  discount_amount: z.number().nullable().optional(),
  amount_paid: z.number(),
  // Nullish like the detail schema: a null currency falls back to NGN at
  // display instead of failing list validation.
  currency: z.string().nullish(),
  recorded_by_user_id: z.string().nullable().optional(),
  import_job_id: z.string().nullable().optional(),
  external_source: z.string().nullable().optional(),
  created_at: z.string(),
  transaction_date: z.string().nullable().optional(),
  invoice_issue_date: z.string().nullable().optional(),
  items: z.array(OrderItemSchema),
  // Effective document kind behind the badge/action: a covered manual
  // balance under a non-paid label opens a receipt, so the card must say
  // receipt instead of "View Invoice".
  document_kind: z.enum(['receipt', 'invoice']).optional(),
});

// ============================================
// RECEIPT DETAIL (full order for HTML generation)
// ============================================

export const ReceiptDetailSchema = z.object({
  id: z.string(),
  order_number: z.string(),
  payment_status: z.string(),
  // Cancellation often lands on the shipping column only: the success
  // screen's terminal predicate needs it for signed-in shoppers.
  shipping_status: z.string().nullable().optional(),
  payment_method: z.string().nullable(),
  total: z.number(),
  subtotal: z.number(),
  shipping_fee: z.number(),
  discount_amount: z.number(),
  tax_amount: z.number(),
  amount_paid: z.number(),
  balance: z.number(),
  // Nullish like the web manual-order schema: a null currency must not
  // fail content validity (the generator defaults display to NGN).
  currency: z.string().nullish(),
  is_credit_order: z.boolean(),
  created_at: z.string(),
  transaction_date: z.string().nullable().optional(),
  invoice_issue_date: z.string().nullable().optional(),
  notes: z.string().nullable(),
  // Sender-permitted null (staff-recorded orders omit it): the preview
  // falls back to email like the emailed document, so rejecting here
  // would blank a card whose documents are valid.
  customer_name: z.string().nullable(),
  customer_email: z.string(),
  customer_phone: z.string().nullable(),
  shipping_address: ShippingAddressSchema.nullable(),
  // Stored Peppol type code (orders.invoice_type_code, default 380):
  // an explicit non-default code survives the proforma derivation.
  invoice_type_code: z.string().nullable().optional(),
  recorded_by_user_id: z.string().nullable().optional(),
  import_job_id: z.string().nullable().optional(),
  external_source: z.string().nullable().optional(),
  items: z.array(OrderItemSchema),
  virtual_account: VirtualAccountSchema.nullable(),
  transactions: z.array(TransactionSchema),
});

// ============================================
// MERCHANT RECEIPT INFO
// ============================================

export const MerchantReceiptInfoSchema = z.object({
  business_name: z.string().nullable(),
  logo_url: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  support_email: z.string().nullable(),
  support_phone: z.string().nullable(),
  rider_phone_number: z.string().nullable().optional(),
  business_address: z.string().nullable(),
  cac_rc_number: z.string().nullable(),
  tax_identification_number: z.string().nullable(),
  legal_entity_name: z.string().nullable(),
  brand_colors: z
    .object({
      primary: z.string(),
      background: z.string().optional(),
      accent: z.string(),
    })
    .nullable(),
  vat_registration_status: z.string().nullable(),
  vat_rate: z.number().nullable(),
  bank_code: z.string().nullable(),
  bank_account_number: z.string().nullable(),
  bank_name: z.string().nullable(),
  bank_account_name: z.string().nullable(),
  social_media: z
    .object({
      instagram: z.string().optional(),
      facebook: z.string().optional(),
      twitter: z.string().optional(),
      tiktok: z.string().optional(),
    })
    .nullable(),
  pages: z
    .object({
      terms: z.string().optional(),
    })
    .nullable(),
});
