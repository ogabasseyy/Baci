import { apiPost } from '@/lib/api-client';

interface ShippingQuoteItem {
  name: string;
  quantity: number;
  weight: number;
  value: number;
}

interface ShippingOptionsQuoteRequest {
  merchantId: string;
  receiverCity: string;
  receiverState: string;
  receiverAddress: string;
  receiverPhone: string;
  receiverName: string;
  quoteItems: ShippingQuoteItem[];
  /** Canonical checkout subtotal, including assurance fees when selected. */
  cartSubtotal: number;
}

export function requestShippingOptions({
  merchantId,
  receiverCity,
  receiverState,
  receiverAddress,
  receiverPhone,
  receiverName,
  quoteItems,
  cartSubtotal,
}: ShippingOptionsQuoteRequest): Promise<unknown> {
  return apiPost<unknown>(
    '/api/shipping/quotes',
    {
      merchantId,
      receiver: {
        name: receiverName || 'Customer',
        phone: receiverPhone || '',
        address: receiverAddress || receiverCity,
        city: receiverCity,
        state: receiverState,
        // This preview path is gated to Nigerian customers upstream.
        country: 'Nigeria',
        countryCode: 'NG',
      },
      items: quoteItems,
      shipmentType: 'domestic',
      // Lets free-over / price-tier merchant rates quote against the same
      // canonical subtotal that order-time validation uses.
      cart_subtotal: cartSubtotal,
      // This checkout threads selected merchant rates back to /api/orders as
      // a bare shipping_rate_id, so they are safe to offer alongside carriers.
      supports_merchant_rates: true,
    },
    {
      headers: { 'x-baci-client': 'web-storefront' },
    }
  );
}
