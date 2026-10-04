import type { ReceiptOrder } from '@baci/shared';
import type { PaymentStatus, ShippingStatus } from '@baci/shared/types';
import type { MerchantPickupAddress } from '@/lib/shipping/merchant-rates/types';

export interface StorefrontOrderItem {
  id: string;
  product_id: string;
  product_slug?: string;
  category?: string;
  category_slug?: string;
  categories?: { name?: string; slug?: string } | null;
  condition?: string | null;
  variant_id?: string;
  variant_name?: string | null;
  name: string;
  product_name?: string;
  quantity: number;
  price: number;
  line_extension_amount?: number;
  unit_code?: string | null;
  vat_category_code?: string | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
  sellers_item_id?: string | null;
  /**
   * API returns `product_images` array in some branches.
   * Components might expect `product_image` or `image`.
   */
  product_images?: string[];
  product_image?: string;
  image_url?: string | null;
  image?: string;
  has_assurance?: boolean;
  /**
   * @deprecated Prefer `fulfillment_details` for new payloads.
   */
  imei?: string | null;
  /**
   * @deprecated Prefer `fulfillment_details` for new payloads.
   */
  serial_number?: string | null;
  /**
   * @deprecated Prefer `fulfillment_details` for new payloads.
   */
  serialNumber?: string | null;
  fulfillment_details?: ReceiptOrder['fulfillment_details'] | null;
}

export interface StorefrontVirtualAccount {
  account_number: string;
  bank_name: string;
  account_name: string;
}

export interface StorefrontTransaction {
  id?: string;
  amount: number;
  created_at: string;
  description: string | null;
  metadata: { payment_method?: string } | null;
}

export type StorefrontDocumentKind = 'invoice' | 'receipt';

export interface StorefrontShippingAddress {
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  [key: string]: unknown;
}

export interface StorefrontOrder {
  id: string;
  order_number: string;
  created_at: string;
  updated_at?: string;

  /**
   * Status field used in realtime updates
   */
  status?: string;

  shipping_status: ShippingStatus | string;
  payment_status: PaymentStatus | string;

  tracking_number?: string;
  tracking_url?: string;

  subtotal?: number;
  total: number;

  shipping_cost?: number;
  shipping_fee?: number;

  shipping_provider?: string;

  /**
   * Soft link to the merchant-configured shipping rate the shopper bought.
   */
  shipping_rate_id?: string;

  /**
   * Durable snapshot of the merchant-configured shipping rate's name (or the
   * pickup-location name) captured at purchase. Preferred over
   * `shipping_provider` when rendering the shipping method for merchant-rate
   * orders (provider `MERCHANT` / `MERCHANT_PICKUP`). Null for carrier orders
   * and older merchant-rate orders that predate rate-name capture.
   */
  shipping_rate_name?: string;

  /**
   * Durable snapshot of a merchant PICKUP rate's collection point (label,
   * address, city, state, instructions), captured at purchase. Present only for
   * merchant-pickup orders (provider `MERCHANT_PICKUP`); null for carrier/ship
   * orders and older pickup orders that predate the snapshot. Lets the customer
   * still see where to collect even if the rate is later edited or deleted.
   */
  shipping_pickup_details?: MerchantPickupAddress | null;

  /**
   * Shipping address might be a formatted string or a structured object (JSONB).
   */
  shipping_address?: string | StorefrontShippingAddress | null;

  /**
   * The payment method used (e.g. 'paystack', 'bank_transfer').
   * API returns snake_case `payment_method`.
   */
  payment_method?: string;

  /**
   * @deprecated Component uses this but API returns `payment_method`.
   */
  payment_provider?: string;

  /**
   * @deprecated Component uses this but API returns `payment_method`.
   */
  paymentMethod?: string;

  currency?: string;
  amount_paid?: number;
  tax_amount?: number;
  discount_amount?: number;
  balance?: number;
  current_document_kind?: StorefrontDocumentKind;
  /**
   * Resolved Peppol invoice type code for the downloadable invoice document
   * ('325' marks an unpaid invoice-method order as proforma). Views use it
   * to label the invoice CTA/badge while the download href keeps the
   * `current_document_kind` route segment.
   */
  invoice_type_code?: string;
  receipt_eligible?: boolean;
  /**
   * Server-derived gate for the customer "Cancel Order" CTA. Authoritative
   * because it is computed by the `customer_order_can_cancel` RPC (the
   * customer-scoped client cannot read the merchant-only transactions table).
   */
  can_cancel?: boolean;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string | null;
  merchant_support_email?: string | null;
  merchant_support_phone?: string | null;
  rider_phone_number?: string | null;
  notes?: string | null;
  virtual_account?: StorefrontVirtualAccount | null;
  fulfillment_details?: ReceiptOrder['fulfillment_details'] | null;
  transactions?: StorefrontTransaction[];

  items: StorefrontOrderItem[];
}
