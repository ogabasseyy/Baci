/**
 * Zod schemas for receipt/invoice data
 *
 * Validates data returned from Supabase queries.
 * Types are inferred from these schemas in types/receipt.ts.
 */

import { z } from 'zod';

// ============================================
// SHARED SUB-SCHEMAS
// ============================================

const OrderItemSchema = z.object({
  id: z.string(),
  product_name: z.string(),
  condition: z.string().nullable().optional(),
  variant_name: z.string().nullable().optional(),
  quantity: z.number(),
  price: z.number(),
  image_url: z.string().nullable().optional(),
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
});

// ============================================
// RECEIPT LIST ITEM
// ============================================

export const ReceiptListItemSchema = z.object({
  id: z.string(),
  order_number: z.string(),
  payment_status: z.string(),
  total: z.number(),
  amount_paid: z.number(),
  currency: z.string(),
  created_at: z.string(),
  transaction_date: z.string().nullable().optional(),
  invoice_issue_date: z.string().nullable().optional(),
  items: z.array(OrderItemSchema),
});

// ============================================
// RECEIPT DETAIL (full order for HTML generation)
// ============================================

export const ReceiptDetailSchema = z.object({
  id: z.string(),
  order_number: z.string(),
  payment_status: z.string(),
  payment_method: z.string().nullable(),
  total: z.number(),
  subtotal: z.number(),
  shipping_fee: z.number(),
  discount_amount: z.number(),
  tax_amount: z.number(),
  amount_paid: z.number(),
  balance: z.number(),
  currency: z.string(),
  is_credit_order: z.boolean(),
  created_at: z.string(),
  transaction_date: z.string().nullable().optional(),
  invoice_issue_date: z.string().nullable().optional(),
  notes: z.string().nullable(),
  customer_name: z.string(),
  customer_email: z.string(),
  customer_phone: z.string().nullable(),
  shipping_address: ShippingAddressSchema.nullable(),
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
