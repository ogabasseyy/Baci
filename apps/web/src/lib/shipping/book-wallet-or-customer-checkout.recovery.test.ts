import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { bookWalletOrCustomerCheckout } from './book-wallet-or-customer-checkout';

const { prepaid, wallet } = vi.hoisted(() => ({
  prepaid: vi.fn(),
  wallet: vi.fn(),
}));
vi.mock('./assert-gigl-customer-checkout-prepaid', () => ({
  assertGiglCustomerCheckoutPrepaid: prepaid,
}));
vi.mock('./book-wallet-funded-order-shipment', () => ({
  bookWalletFundedOrderShipment: wallet,
}));
it('books the recovered checkout quote directly without merchant-wallet quote preparation', async () => {
  prepaid.mockResolvedValue(undefined);
  const result = {
    shipmentId: 'shipment',
    provider: 'GIGL' as const,
    providerShipmentId: 'waybill',
    trackingNumber: 'waybill',
    carrierName: 'GIG Logistics',
    quoteId: 'recovered-quote',
    estimatedDays: 2,
    shipmentStatus: 'booked' as const,
  };
  const book = vi.fn().mockResolvedValue(result);
  const prepareWalletQuote = vi
    .fn()
    .mockRejectedValue(new Error('Wallet-only preflight must not run'));
  const supabase = {} as SupabaseClient;
  await expect(
    bookWalletOrCustomerCheckout(
      supabase,
      'merchant',
      'order',
      'recovered-quote',
      'customer_checkout',
      book,
      undefined,
      prepareWalletQuote,
      undefined,
      {
        shipping_provider: 'GIGL',
        payment_status: 'paid',
        payment_method: 'paystack',
      }
    )
  ).resolves.toEqual(result);
  expect(prepaid).toHaveBeenCalledOnce();
  expect(book).toHaveBeenCalledWith('recovered-quote');
  expect(prepareWalletQuote).not.toHaveBeenCalled();
  expect(wallet).not.toHaveBeenCalled();
});
