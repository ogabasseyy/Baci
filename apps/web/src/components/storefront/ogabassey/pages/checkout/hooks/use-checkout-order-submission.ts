'use client';

import {
  prepareSharedCartCheckout,
  reviewedCheckoutItems,
} from '@/hooks/cart/shared-cart-client';
import { toast } from '@/hooks/use-toast';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import { calculateCartItemSubtotal } from '@/lib/checkout/cart-entitlement-sanitizer';
import type { SharedCartOrderBinding } from '../types';
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

    if (
      resumed.order &&
      resumed.preferredGateway &&
      cart.checkoutCart.length === 0
    ) {
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

    // Shared carts review the authoritative cart first; the order submit
    // binds to the returned session and generation. A stale review
    // refreshes the cart view and stops: the shopper reviews the updated
    // cart and submits again, never silently resubmitting changed lines.
    let sharedCartBinding: SharedCartOrderBinding | null = null;
    let reviewedCheckoutItemsResult: ReturnType<
      typeof buildCheckoutOrderItems
    > | null = null;
    if (cart.sharedCartRef) {
      // The binding pins the reviewed version, but the order items come
      // from the display cart: submitting with unconfirmed optimistic
      // lines would order lines outside the reviewed version. Wait for
      // a clean sync so display and confirmed lines agree.
      if (cart.sharedCartSyncStatus !== 'synced') {
        if (cart.sharedCartSyncStatus === 'error') {
          toast({ title: 'Cart Sync Failed', description: 'Your cart could not sync. Retry the sync and submit again.', variant: 'destructive' });
        } else {
          toast({ title: 'Cart Syncing', description: 'Your cart is still syncing. Wait a moment and submit again.', variant: 'destructive' });
        }
        processing.isOrderInFlightRef.current = false;
        return;
      }
      const review = await prepareSharedCartCheckout({
        cartId: cart.sharedCartRef.cartId,
        expectedVersion: cart.sharedCartRef.version,
        operationId: crypto.randomUUID(),
      }, merchant?.slug);
      if (!review.ok) {
        if (review.code === 'refresh_required') {
          await cart.refreshSharedCart?.();
          toast({ title: 'Cart Changed', description: 'Your cart changed during checkout. Review the updated cart and submit again.', variant: 'destructive' });
        } else {
          toast({ title: 'Checkout Unavailable', description: 'We could not review your cart. Please try again.', variant: 'destructive' });
        }
        processing.isOrderInFlightRef.current = false;
        return;
      }
      // The review is authoritative for availability and price. A line
      // that became unavailable, or a subtotal that moved without a
      // version change, stops here with a refreshed cart: the shopper
      // reviews the updated lines and submits again, mirroring the
      // native checkout path.
      if (
        review.review.unavailableCount > 0 ||
        review.review.lines.some((line) => !line.available)
      ) {
        await cart.refreshSharedCart?.();
        toast({ title: 'Update Your Cart', description: 'Some items are unavailable. Review your updated cart and submit again.', variant: 'destructive' });
        processing.isOrderInFlightRef.current = false;
        return;
      }
      // The reviewed subtotal is items-only: assurance is priced per
      // order item at binding time, so comparing against the
      // assurance-inclusive checkoutCartTotal would reject every
      // insured cart. checkoutCart is already entitlement-sanitized,
      // hence the permissive flag on the recompute.
      if (
        Math.abs(
          review.review.subtotalMinor / 100 -
            calculateCartItemSubtotal(cart.checkoutCart, true)
        ) > 0.005
      ) {
        await cart.refreshSharedCart?.();
        toast({ title: 'Prices Updated', description: 'Prices changed during checkout. Review the updated cart and submit again.', variant: 'destructive' });
        processing.isOrderInFlightRef.current = false;
        return;
      }
      const reviewedItems = reviewedCheckoutItems(
        cart.checkoutCart,
        review.review
      );
      if (!reviewedItems) {
        await cart.refreshSharedCart?.();
        toast({ title: 'Cart Changed', description: 'Your cart changed during checkout. Review the updated cart and submit again.', variant: 'destructive' });
        processing.isOrderInFlightRef.current = false;
        return;
      }
      reviewedCheckoutItemsResult = buildCheckoutOrderItems(reviewedItems);
      sharedCartBinding = {
        cart_id: review.review.cartId,
        cart_version: review.review.cartVersion,
        checkout_generation: review.review.generation,
        checkout_session_id: review.review.checkoutSessionId,
      };
    }

    await submitPreparedCheckout(
      { ...context, merchant },
      sharedCartBinding
        ? {
            ...prepared,
            identity: {
              ...prepared.identity,
              ...(reviewedCheckoutItemsResult
                ? { items: reviewedCheckoutItemsResult }
                : {}),
              sharedCartBinding,
            },
          }
        : prepared
    );
  };

  return { handlePlaceOrder };
}
