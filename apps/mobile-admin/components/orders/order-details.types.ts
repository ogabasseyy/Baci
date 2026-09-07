import type { OrderFulfillmentDetails, VariantAttributes } from '@baci/shared';
import type { PaymentStatus, ShippingStatus } from '@/hooks/useOrders';

export interface OrderDetailsItem {
  condition?: string;
  display_condition?: string;
  display_image_url?: string;
  has_assurance?: boolean;
  id: string;
  image_url?: string;
  name: string;
  price: number;
  product_name?: string;
  product_id?: string | null;
  product_match_status?: 'custom' | 'linked' | 'unreviewed';
  quantity: number;
  details?: string;
  variant_attributes?: VariantAttributes | null;
  variant_id?: string | null;
  variant_name?: string;
}

export interface OrderDetailsRecord {
  amount_paid: number;
  balance: number;
  cancelled_at?: string | null;
  created_at: string;
  currency?: string | null;
  customer_email: string;
  customer_name: string;
  customer_phone: string | null;
  delivery_method?: string | null;
  discount_amount: number;
  fulfillment_details?: OrderFulfillmentDetails | null;
  id: string;
  is_credit_order?: boolean | null;
  items?: OrderDetailsItem[];
  order_number: string;
  payment_method?: string | null;
  payment_status: PaymentStatus;
  recorded_by_name?: string | null;
  self_fulfillment_data?: {
    carrierName?: string | null;
    dispatchPhone?: string | null;
  } | null;
  shipping_address:
    | {
        address?: string | null;
        city?: string | null;
        state?: string | null;
      }
    | string
    | null;
  shipping_fee?: number | null;
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  airport_type?: string | null;
  shipping_provider?: string | null;
  shipping_status: ShippingStatus;
  source?: string | null;
  staff_terminal?: {
    account_name: string;
    account_number: string;
    bank_name: string;
  } | null;
  subtotal?: number | null;
  tax_amount?: number | null;
  tax_basis?: 'exclusive' | 'inclusive' | null;
  tax_exclusive_amount?: number | null;
  tax_inclusive_amount?: number | null;
  total: number;
  updated_at: string;
  virtual_account?: {
    assignment_customer_email_source?: string | null;
    account_name: string;
    account_number: string;
    bank_name: string;
    assigned_at?: string | null;
    created_at?: string | null;
    expires_at?: string | null;
    provider?: string | null;
  } | null;
}

export interface OrderSourceInfo {
  color: string;
  label: string;
  name: string;
}
