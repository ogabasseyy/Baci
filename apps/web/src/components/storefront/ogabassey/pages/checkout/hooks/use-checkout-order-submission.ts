'use client';

import { toast } from '@/hooks/use-toast';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import { KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST } from '../utils';
import { executeResumedDirectPayment } from '../handlers/direct-payment';
import { submitPreparedCheckout } from '../handlers/submit-prepared-checkout';
import { prepareCheckoutOrderSubmission } from '../prepare-checkout-order-submission';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';

/** Own submit validation, resume dispatch, issue recovery, and fresh-order handoff. */
export function useCheckoutOrderSubmission(context: CheckoutOrderSubmissionContext) {
  const handlePlaceOrder = async () => {
    const { account, cart, contact, delivery, merchant, navigation, order, payment, processing, resumed } = context;
    const { session: paymentSession } = payment;
    if (!processing.tryBeginSubmission(
      paymentSession.redvault.status === 'pending' || paymentSession.redvault.status === 'held'
    )) return;

    if (!merchant?.id) {
      toast({ title: 'Error', description: 'Merchant context not available. Please try again.', variant: 'destructive' });
      processing.isOrderInFlightRef.current = false;
      return;
    }
    if (!contact.customerEmail || !contact.firstName || !contact.lastName) {
      toast({ title: 'Missing Information', description: 'Please fill in your name and email.', variant: 'destructive' });
      processing.isOrderInFlightRef.current = false;
      return;
    }

    if (resumed.order && resumed.preferredGateway) {
      processing.setIsProcessing(true);
      await executeResumedDirectPayment({
        resumedOrder: resumed.order,
        preferredGateway: resumed.preferredGateway,
        merchantSlug: merchant.slug,
        merchantChargeCurrency: payment.currencyCode,
        resumeTrackingToken: resumed.trackingToken,
        resumeMerchantSlug: resumed.merchantSlugFromResume,
        setIsProcessing: processing.setIsProcessing,
        clearCheckoutSession: order.clearCheckoutSession,
        routerPush: (url) => navigation.pushSuccessRoute(url),
        getHref: navigation.getHref,
      }).finally(() => {
        processing.isOrderInFlightRef.current = false;
      });
      return;
    }

    const prepared = prepareCheckoutOrderSubmission({
      payment: {
        method: paymentSession.method,
        bankTransferAvailable: payment.bankTransferAvailable,
        paystackAvailable: payment.paystackAvailable,
        korapayAvailable: payment.korapayAvailable,
        redvaultAvailable: payment.redvaultAvailable,
        remainingAmount: paymentSession.wallet.remainingAmount,
        total: paymentSession.total,
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
        merchantId: merchant.id,
        customerEmail: contact.customerEmail,
        customerName: `${contact.firstName} ${contact.lastName}`.trim(),
        customerPhone: contact.customerPhone,
        checkoutItems: buildCheckoutOrderItems(cart.checkoutCart),
        useWalletCredit: paymentSession.checkoutValues.useWalletCredit,
        walletAmountUsed: paymentSession.wallet.amountUsed,
        discountCode: paymentSession.checkoutValues.discountCode,
        giftWrappingCost: delivery.giftWrappingCost,
      },
    });

    if (prepared.kind === 'issue') {
      if (prepared.issue === 'delivery-option') {
        toast({ title: 'Select Delivery Option', description: 'Please select a delivery option before placing your order.', variant: 'destructive' });
        navigation.setCurrentStep('delivery');
        navigation.setCompletedSteps((previous) => ({ ...previous, delivery: false }));
        processing.isOrderInFlightRef.current = false;
        return;
      }
      if (
        prepared.issue === 'bank-transfer-unavailable' ||
        prepared.issue === 'paystack-unavailable' ||
        prepared.issue === 'korapay-unavailable' ||
        prepared.issue === 'redvault-unavailable'
      ) {
        const message = {
          'bank-transfer-unavailable': 'Bank transfer is not available for this store yet. Please choose a different payment method.',
          'paystack-unavailable': 'Paystack is not available for this store yet. Please choose a different payment method.',
          'korapay-unavailable': 'Korapay is not available for this store yet. Please choose a different payment method.',
          'redvault-unavailable': 'Pay with UBA is not available right now. Please choose a different payment method.',
        }[prepared.issue];
        toast({ title: 'Payment Unavailable', description: message, variant: 'destructive' });
        processing.isOrderInFlightRef.current = false;
        return;
      }
      if (prepared.issue === 'klump-unavailable') {
        toast(KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST);
        processing.releaseSubmission();
        return;
      }
      if (prepared.issue === 'incomplete-address') {
        toast({ title: 'Incomplete Address', description: 'Please enter your full address (Street, City, State).', variant: 'destructive' });
        processing.setIsProcessing(false);
        navigation.setCompletedSteps((previous) => ({ ...previous, delivery: false }));
        processing.isOrderInFlightRef.current = false;
        navigation.setCurrentStep('delivery');
        return;
      }
      if (prepared.issue === 'delivery-required') {
        toast({ title: 'Delivery option required', description: 'Please select a delivery option to continue.', variant: 'destructive' });
        processing.releaseSubmission();
        return;
      }
      toast({ title: 'Shipping rate expired', description: 'Please select a delivery option again.', variant: 'destructive' });
      processing.releaseSubmission();
      return;
    }

    await submitPreparedCheckout({ ...context, merchant }, prepared);
  };

  return { handlePlaceOrder };
}
