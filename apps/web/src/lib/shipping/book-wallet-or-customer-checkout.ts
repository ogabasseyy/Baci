import type { SupabaseClient } from '@supabase/supabase-js';
import { assertGiglCustomerCheckoutPrepaid } from './assert-gigl-customer-checkout-prepaid';
import type { BookOrderShipmentResult } from './book-order-shipment';
import { bookWalletFundedOrderShipment } from './book-wallet-funded-order-shipment';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

type ReleaseLock = () => Promise<void>;
type PrepareQuote = () => Promise<string>;
type BookShipment = (quoteId?: string) => Promise<BookOrderShipmentResult>;
type ReadExistingShipment = () => Promise<BookOrderShipmentResult | null>;
type GiglBookingPaymentContext = Parameters<
  typeof assertGiglCustomerCheckoutPrepaid
>[0] & {
  settledRetainedAmount?: number;
};

export async function bookWalletOrCustomerCheckout(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  quoteId: string,
  fundingSource: 'customer_checkout' | 'merchant_wallet' | null | undefined,
  book: BookShipment,
  releaseLock?: ReleaseLock,
  prepareQuote?: PrepareQuote,
  readExistingShipment?: ReadExistingShipment,
  orderPayment?: GiglBookingPaymentContext
) {
  if (fundingSource !== 'merchant_wallet') {
    const { settledRetainedAmount, ...paymentFields } = orderPayment ?? {};
    await assertGiglCustomerCheckoutPrepaid(
      {
        shipping_funding_source: fundingSource,
        ...paymentFields,
      },
      {
        supabase,
        merchantId,
        orderId,
        settledRetainedAmount,
      }
    );
    return book(quoteId);
  }
  if (!merchantId || !orderId || !quoteId) {
    throw new OrderShipmentBookingError(
      'Wallet-funded booking requires the order booking path.',
      409,
      'USE_ORDER_SHIPMENT_BOOKING'
    );
  }
  return bookWalletFundedOrderShipment(
    supabase,
    merchantId,
    orderId,
    quoteId,
    book,
    releaseLock,
    prepareQuote,
    readExistingShipment
  );
}
