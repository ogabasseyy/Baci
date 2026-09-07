import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { assertGiglCustomerCheckoutPrepaid } from '@/lib/shipping/assert-gigl-customer-checkout-prepaid';
import { isShippingProviderCode } from '@/lib/shipping/order-shipment-booking-utils';
import type { OrderShipmentQuoteRecord } from '@/lib/shipping/refresh-order-shipment-quote';
import {
  applyShippingQuoteBookingEconomicsToOrder,
  applyShippingQuoteBookingEconomicsToQuote,
  getShippingQuoteBookingEconomics,
} from '@/lib/shipping/shipping-quote-booking-economics';
import { getShippingQuoteBookingMetadata } from '@/lib/shipping/shipping-quote-booking-metadata';
import type { ShipmentItem, ShippingAddress } from '@/lib/shipping/types';
import {
  resolveBookingQuoteRequestPayload,
  validateBookingQuoteRequestPayload,
} from './quote-request-payload';

type DirectBookingRequest = {
  orderId: string;
  quoteId: string;
  receiver: ShippingAddress;
  items: ShipmentItem[];
};

type DirectBookingOrder = {
  id: string;
  merchant_id: string;
  selected_quote_id: string | null;
  shipping_funding_source: 'customer_checkout' | 'merchant_wallet' | null;
  shipping_provider: string | null;
  shipping_status: string;
  shipping_fee: number | null;
  payment_method: string | null;
  payment_status: string | null;
  shipping_platform_retained_amount?: number | string | null;
  shipping_address: unknown;
  order_items: Array<{
    name: string;
    quantity: number;
    price: number;
    product_id?: string | null;
    product?: unknown;
  }> | null;
};

export type LoadedDirectBookingContext = {
  order: DirectBookingOrder;
  quote: OrderShipmentQuoteRecord;
  bookingQuote: OrderShipmentQuoteRecord;
  quotePayload: NonNullable<
    ReturnType<typeof resolveBookingQuoteRequestPayload>
  >;
  usesStoredInternationalSender: boolean;
};

export type LoadDirectBookingContextResult =
  | { ok: true; context: LoadedDirectBookingContext }
  | { ok: false; response: NextResponse };

export async function loadDirectBookingContext(
  supabase: SupabaseClient,
  merchantId: string,
  data: DirectBookingRequest
): Promise<LoadDirectBookingContextResult> {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      'id, merchant_id, selected_quote_id, shipping_funding_source, shipping_provider, shipping_status, shipping_fee, payment_method, payment_status, shipping_address, order_items(name, quantity, price, product_id, product:products!order_items_product_id_fkey(weight_value, weight_unit, dimensions, commodity_code))'
    )
    .eq('id', data.orderId)
    .eq('merchant_id', merchantId)
    .single();

  if (orderError || !order) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      ),
    };
  }

  if (order.shipping_funding_source === 'merchant_wallet') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            'Merchant-wallet orders must be booked from the order workflow.',
          code: 'USE_ORDER_SHIPMENT_BOOKING',
        },
        { status: 409 }
      ),
    };
  }

  if (['shipped', 'delivered', 'processing'].includes(order.shipping_status)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Order has already been shipped or is being processed' },
        { status: 400 }
      ),
    };
  }

  if (order.selected_quote_id && order.selected_quote_id !== data.quoteId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Quote does not match order' },
        { status: 400 }
      ),
    };
  }

  const { data: quote, error: quoteError } = await supabase
    .from('shipping_quotes')
    .select(
      'id, merchant_id, provider, service_tier, carrier_name, provider_rate_id, quote_request, expires_at, price, currency, estimated_days'
    )
    .eq('id', data.quoteId)
    .eq('merchant_id', merchantId)
    .single();

  if (quoteError || !quote) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Quote not found or expired' },
        { status: 404 }
      ),
    };
  }

  const bookingMetadata = await getShippingQuoteBookingMetadata(
    supabase,
    merchantId,
    data.orderId,
    quote.id
  );
  const bookingEconomics = await getShippingQuoteBookingEconomics(
    supabase,
    merchantId,
    data.orderId,
    quote.id
  );
  const quoteWithEconomics = applyShippingQuoteBookingEconomicsToQuote(
    quote,
    bookingEconomics
  );
  const orderWithEconomics = applyShippingQuoteBookingEconomicsToOrder(
    order,
    bookingEconomics
  );
  const bookingQuote: OrderShipmentQuoteRecord = {
    ...quoteWithEconomics,
    provider_metadata: bookingMetadata,
  };

  const quotePayload = resolveBookingQuoteRequestPayload(
    bookingQuote,
    {
      ...data.receiver,
      country: data.receiver.country || 'Nigeria',
      countryCode: data.receiver.countryCode || 'NG',
    },
    data.items,
    order.order_items ?? []
  );
  if (!quotePayload) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Saved international quote request not found' },
        { status: 400 }
      ),
    };
  }

  const quoteValidation = validateBookingQuoteRequestPayload(
    quotePayload,
    order,
    merchantId
  );
  if (!quoteValidation.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: quoteValidation.error, code: quoteValidation.code },
        { status: quoteValidation.status }
      ),
    };
  }

  if (!isShippingProviderCode(quote.provider)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid shipping provider in quote' },
        { status: 400 }
      ),
    };
  }

  await assertGiglCustomerCheckoutPrepaid(
    {
      payment_method: orderWithEconomics.payment_method,
      payment_status: orderWithEconomics.payment_status,
      shipping_funding_source: orderWithEconomics.shipping_funding_source,
      shipping_platform_retained_amount:
        orderWithEconomics.shipping_platform_retained_amount,
      shipping_provider: orderWithEconomics.shipping_provider ?? quote.provider,
    },
    {
      supabase,
      merchantId,
      orderId: orderWithEconomics.id,
    }
  );

  return {
    ok: true,
    context: {
      order: orderWithEconomics,
      quote: {
        ...quote,
        provider_metadata: null,
      },
      bookingQuote,
      quotePayload,
      usesStoredInternationalSender: Boolean(quotePayload.sender),
    },
  };
}
