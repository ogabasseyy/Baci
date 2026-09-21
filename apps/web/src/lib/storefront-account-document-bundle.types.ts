import type { ReceiptOrder } from '@baci/shared';
import type { MerchantPickupAddress } from '@/lib/shipping/merchant-rates/types';

type JsonRecord = Record<string, unknown>;
type MoneyValue = number | string | null;
export type RateValue = number | string | null;
type AddressValue = JsonRecord | string | null;

export interface StorefrontAccountDocumentMerchantRow {
  business_name: string;
  logo_url: string | null;
  email: string | null;
  phone: string | null;
  support_email: string | null;
  support_phone: string | null;
  rider_phone_number?: string | null;
  business_address: string | null;
  cac_rc_number: string | null;
  tax_identification_number: string | null;
  legal_entity_name: string | null;
  brand_colors: JsonRecord | null;
  vat_registration_status: string | null;
  vat_rate: number | null;
  bank_code: string | null;
  bank_account_number: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  social_media: JsonRecord | null;
  pages: JsonRecord | null;
  registered_address: JsonRecord | null;
}

export interface StorefrontAccountDocumentCustomerRow {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface StorefrontAccountDocumentOrderRow {
  id: string;
  order_number: string;
  external_source?: string | null;
  import_job_id?: string | null;
  created_at: string;
  transaction_date?: string | null;
  updated_at: string | null;
  payment_status: string | null;
  shipping_status: string | null;
  currency: string | null;
  total: MoneyValue;
  subtotal: MoneyValue;
  shipping_fee: MoneyValue;
  tax_amount: MoneyValue;
  discount_amount: MoneyValue;
  amount_paid: MoneyValue;
  shipping_address: AddressValue;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  payment_method: string | null;
  is_credit_order: boolean | null;
  tracking_number: string | null;
  shipping_provider: string | null;
  shipping_rate_id?: string | null;
  shipping_rate_name?: string | null;
  /**
   * Durable snapshot of a merchant PICKUP rate's collection point (label,
   * address, city, state, instructions), captured at purchase. Null for
   * carrier/ship orders and older pickup orders that predate the snapshot.
   */
  shipping_pickup_details?: MerchantPickupAddress | null;
  notes: string | null;
  invoice_type_code: string | null;
  invoice_issue_date: string | null;
  tax_point_date: string | null;
  payment_due_date: string | null;
  buyer_reference: string | null;
  purchase_order_reference: string | null;
  tax_exclusive_amount: MoneyValue;
  tax_inclusive_amount: MoneyValue;
  invoice_note: string | null;
  firs_irn: string | null;
  firs_csid: string | null;
  firs_qr_code: string | null;
  payment_terms: string | null;
  fulfillment_details?: ReceiptOrder['fulfillment_details'] | null;
}

export interface StorefrontAccountDocumentItemRow {
  id: string;
  product_id: string | null;
  condition?: string | null;
  variant_id: string | null;
  variant_name: string | null;
  name: string;
  quantity: number | null;
  price: MoneyValue;
  assurance_fee?: MoneyValue;
  line_extension_amount?: MoneyValue;
  unit_code?: string | null;
  vat_category_code?: string | null;
  vat_rate?: RateValue;
  vat_amount?: MoneyValue;
  sellers_item_id?: string | null;
  /** Raw fulfillment data selected from order_items.fulfillment_data. */
  fulfillment_data?: ReceiptOrder['fulfillment_details'] | null;
  /** Normalized or legacy fulfillment details used before falling back to raw data. */
  fulfillment_details?: ReceiptOrder['fulfillment_details'] | null;
}

export interface StorefrontAccountDocumentTransactionRow {
  id: string | null;
  amount: MoneyValue;
  created_at: string;
  description: string | null;
  metadata: JsonRecord | null;
  gateway?: string | null;
  status?: string | null;
  transaction_type?: string | null;
}

export interface StorefrontAccountDocumentPaymentAccountRow {
  account_number: string;
  assignment_customer_email_source?: string | null;
  assigned_at?: string | null;
  bank_name: string | null;
  account_name: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  provider?: string | null;
}

export interface StorefrontAccountDocumentTaxSubtotalRow {
  vat_category_code: string;
  vat_rate: RateValue;
  taxable_amount: MoneyValue;
  tax_amount: MoneyValue;
  exemption_reason: string | null;
}
