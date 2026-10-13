import type { SupabaseClient } from '@supabase/supabase-js';
import { bookOrderShipment } from '@/lib/shipping/book-order-shipment';
import { bookWalletOrCustomerCheckout } from '@/lib/shipping/book-wallet-or-customer-checkout';
import { findReusableOrderShipment } from '@/lib/shipping/find-reusable-order-shipment';
import { clearOrderShipmentBookingLock } from '@/lib/shipping/order-shipment-booking-lock';
import { refreshWalletOrderShipmentQuote } from '@/lib/shipping/refresh-wallet-order-shipment-quote';
import { getShippingQuoteBookingEconomics } from '@/lib/shipping/shipping-quote-booking-economics';

export type ClaimedOrderBookingSource = {
  selected_quote_id: string | null;
  shipping_funding_source: 'customer_checkout' | 'merchant_wallet' | null;
  shipping_provider: string | null;
  payment_status: string | null;
  payment_method: string | null;
};

export type ClaimedOrderBookingResult = {
  provider: string;
  quoteId: string;
  shipmentId: string;
  trackingNumber: string | null;
};

/**
 * After a shipment-booking claim succeeds, load booking economics and run the
 * wallet-or-checkout orchestration (reserve / refresh / lock release / recover).
 */
export async function runClaimedOrderWalletOrCheckoutBooking(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  existingOrder: ClaimedOrderBookingSource,
  options: {
    paymentStatus?: string | null;
    lockToken?: string | null;
  } = {}
): Promise<ClaimedOrderBookingResult> {
  const selectedQuoteId = existingOrder.selected_quote_id ?? '';
  const bookingEconomics = selectedQuoteId
    ? await getShippingQuoteBookingEconomics(
        supabase,
        merchantId,
        orderId,
        selectedQuoteId
      )
    : null;
  const lockToken = options.lockToken ?? null;

  const booking = await bookWalletOrCustomerCheckout(
    supabase,
    merchantId,
    orderId,
    selectedQuoteId,
    existingOrder.shipping_funding_source,
    (quoteId) => bookOrderShipment(supabase, merchantId, orderId, quoteId),
    lockToken
      ? () =>
          clearOrderShipmentBookingLock(
            supabase,
            merchantId,
            orderId,
            lockToken
          )
      : undefined,
    () =>
      refreshWalletOrderShipmentQuote(
        supabase,
        merchantId,
        orderId,
        selectedQuoteId
      ),
    async () => {
      const existing = await findReusableOrderShipment(
        supabase,
        merchantId,
        orderId
      );
      return existing
        ? {
            ...existing,
            quoteId: existing.quoteId || selectedQuoteId,
          }
        : null;
    },
    {
      shipping_provider: existingOrder.shipping_provider,
      payment_status: options.paymentStatus ?? existingOrder.payment_status,
      payment_method: existingOrder.payment_method,
      shipping_funding_source: existingOrder.shipping_funding_source,
      shipping_platform_retained_amount:
        bookingEconomics?.shipping_platform_retained_amount ?? null,
    }
  );

  return {
    provider: booking.provider,
    quoteId: booking.quoteId,
    shipmentId: booking.shipmentId,
    trackingNumber: booking.trackingNumber,
  };
}
