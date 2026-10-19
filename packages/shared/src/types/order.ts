/**
 * Shared Order Types
 * Used by both web dashboard and mobile admin app
 */

export type ShippingStatus =
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export type PaymentStatus =
  | 'paid'
  | 'unpaid'
  | 'pending'
  | 'failed'
  | 'refunded'
  | 'partially_paid'
  | 'bnpl_approved'
  | 'bnpl_pending';

export type OrderSource =
  | 'online_store'
  | 'storefront'
  | 'whatsapp'
  | 'instagram'
  | 'web'
  | 'manual'
  | 'staff_entry'
  | 'facebook'
  | 'tiktok'
  | 'jumia'
  | 'jiji'
  | 'konga'
  | 'physical'
  | string;

export type VariantAttributePrimitive = string | number | boolean | null;
export type VariantAttributeValue =
  | VariantAttributePrimitive
  | VariantAttributeValue[]
  | { [key: string]: VariantAttributeValue };
export type VariantAttributes = VariantAttributeValue;

export interface OrderItem {
  id: string;
  product_id: string | null;
  name: string;
  product_name: string;
  /** Catalog category label used for order display and fulfillment rules. */
  category?: string | null;
  /** Canonical catalog category slug when the ordered product is linked. */
  category_slug?: string | null;
  condition?: string;
  details?: string;
  has_assurance?: boolean;
  product_match_status?: 'custom' | 'linked' | 'unreviewed';
  variant_attributes?: VariantAttributes | null;
  variant_id?: string | null;
  variant_name?: string;
  quantity: number;
  price: number;
  total?: number;
  image_url?: string;
}

export interface OrderFulfillmentDetails {
  imei?: string | null;
  items?: Array<{
    id?: string | null;
    imei?: string | null;
    orderItemId?: string | null;
    order_item_id?: string | null;
    productName?: string | null;
    product_name?: string | null;
    serialNumber?: string | null;
    serial_number?: string | null;
    unitCount?: number | null;
    unitIndex?: number | null;
    unit_count?: number | null;
    unit_index?: number | null;
    variantName?: string | null;
    variant_name?: string | null;
  }>;
  serialNumber?: string | null;
  serial_number?: string | null;
}

export interface OrderSelfFulfillmentData {
  carrierName?: string | null;
  dispatchNotes?: string | null;
  dispatchPhone?: string | null;
  fulfilledAt?: string | null;
  fulfilledBy?: string | null;
  trackingNumber?: string | null;
}

export interface Order {
  id: string;
  order_number: string;
  merchant_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_status: ShippingStatus;
  payment_status: PaymentStatus;
  total: number;
  subtotal: number;
  shipping_fee: number;
  tax_amount: number;
  discount_amount: number;
  currency: string;
  source: OrderSource | null;
  payment_method: string | null;
  notes: string | null;
  is_credit_order?: boolean;
  delivery_method?: string | null;
  airport_type?: string | null;
  selected_quote_id?: string | null;
  shipping_provider?: string | null;
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  tracking_number?: string | null;
  tracking_token?: string | null;
  shipment_id?: string | null;
  fulfillment_type?: 'provider' | 'self' | null;
  fulfillment_details?: OrderFulfillmentDetails | null;
  self_fulfillment_data?: OrderSelfFulfillmentData | null;
  shipping_address?: {
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  } | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
  items?: OrderItem[];
}
