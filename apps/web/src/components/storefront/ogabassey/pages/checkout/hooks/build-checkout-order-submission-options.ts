import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import type { PrepareCheckoutOrderSubmissionOptions } from '../prepare-checkout-order-submission';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';

/** Collect current checkout inputs for validation and identity preparation. */
export function buildCheckoutOrderSubmissionOptions(
  context: CheckoutOrderSubmissionContext,
  merchantId: string
): PrepareCheckoutOrderSubmissionOptions {
  const { cart, contact, delivery, payment } = context;
  const session = payment.session;
  return {
    payment: {
      method: session.method,
      bankTransferAvailable: payment.bankTransferAvailable,
      paystackAvailable: payment.paystackAvailable,
      korapayAvailable: payment.korapayAvailable,
      redvaultAvailable: payment.redvaultAvailable,
      remainingAmount: session.wallet.remainingAmount,
      total: session.total,
    },
    delivery: {
      method: delivery.method,
      selectedQuoteId: delivery.session.quotes.selectedId,
      selectedQuoteMatchesMethod: delivery.session.quotes.matchesSelectedMethod,
      airportRequiresQuote: delivery.airportRequiresQuote,
      airportType: delivery.airportType,
      quotes: delivery.session.quotes.items,
      addresses: delivery.session.address.addresses,
      selectedAddressId: delivery.session.address.selectedId,
      isNewAddressMode: delivery.session.address.isNewMode,
      newAddressStreet: delivery.newAddressStreet,
      newAddressCity: delivery.newAddressCity,
      newAddressState: delivery.newAddressState,
      customerPhone: contact.customerPhone,
      merchantCountry: delivery.merchantCountry,
      deliveryCost: delivery.session.cost,
    },
    identity: {
      merchantId,
      customerEmail: contact.customerEmail,
      customerName: `${contact.firstName} ${contact.lastName}`.trim(),
      customerPhone: contact.customerPhone,
      checkoutItems: buildCheckoutOrderItems(cart.checkoutCart),
      useWalletCredit: session.checkoutValues.useWalletCredit,
      walletAmountUsed: session.wallet.amountUsed,
      discountCode: session.checkoutValues.discountCode,
      giftWrappingCost: delivery.giftWrappingCost,
    },
  };
}
