import type { InternationalShipmentOrderItem } from '@/lib/shipping/international-shipment-items';

export type BookOrderRecord = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  shipping_fee: number | string | null;
  selected_quote_id: string | null;
  shipping_provider: string | null;
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  payment_method?: string | null;
  payment_status?: string | null;
  shipping_provider_cost?: number | string | null;
  shipping_platform_margin?: number | string | null;
  shipping_pricing_version?: string | null;
  shipping_platform_retained_amount?: number | string | null;
  shipping_address: {
    address?: string | null;
    city?: string | null;
    country?: string | null;
    countryCode?: string | null;
    postalCode?: string | null;
    state?: string | null;
    phone?: string | null;
  } | null;
  order_items: InternationalShipmentOrderItem[] | null;
};
