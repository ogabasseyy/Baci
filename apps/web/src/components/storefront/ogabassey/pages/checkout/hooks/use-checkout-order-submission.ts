'use client';

import { isOxygenStorefrontStagingEnabled } from '@/config/oxygen-storefront-staging';
import {
  prepareSharedCartCheckout,
  reviewedCheckoutItems,
} from '@/hooks/cart/shared-cart-client';
import { isSharedCartCheckoutDeadlineExpired } from '@/hooks/cart/shared-cart-checkout-deadline';
import { toast } from '@/hooks/use-toast';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import { calculateCartItemSubtotal } from '@/lib/checkout/cart-entitlement-sanitizer';
import { handleSharedRedvaultReview } from '../handlers/handle-shared-redvault-review';
import { checkOxygenStorefrontAvailability } from '../check-oxygen-storefront-availability';
import { submitPreparedCheckout } from '../handlers/submit-prepared-checkout';
import { prepareCheckoutOrderSubmission } from '../prepare-checkout-order-submission';
import type { SharedCartOrderBinding } from '../types';
import { KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST } from '../utils';
import { beginCheckoutOrderSubmission } from './begin-checkout-order-submission';
import { buildCheckoutOrderSubmissionOptions } from './build-checkout-order-submission-options';
import { buildSharedCartPrepareInput } from './build-shared-cart-prepare-input';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';
import { handleTerminalRedvaultDeliveryIssue } from './handle-terminal-redvault-delivery-issue';

/** Own submit validation, resume dispatch, issue recovery, and fresh-order handoff. */
export function useCheckoutOrderSubmission(
  context: CheckoutOrderSubmissionContext
) {
  const handlePlaceOrder = async () => {
    const merchant = await beginCheckoutOrderSubmission(context);
    if (!merchant) return;
    const { cart, navigation, payment, processing } = context;
    const { session: paymentSession } = payment;

    if (paymentSession.method === 'oxygen' && paymentSession.wallet.remainingAmount > 0 &&
      ((!isOxygenStorefrontStagingEnabled() && !(await checkOxygenStorefrontAvailability(merchant.id))) || payment.currencyCode !== 'NGN' ||
       !(await context.account.waitForResolvedCustomerAuth()))) {
      toast({ title: 'Payment plan unavailable', description: 'Sign in to continue with Oxygen. This payment plan must be available for your store and currency.', variant: 'destructive' });
      processing.releaseSubmission();
      return;
    }
    const submissionOptions = buildCheckoutOrderSubmissionOptions(
      context,
      merchant.id
    );
    const prepared = prepareCheckoutOrderSubmission(submissionOptions);

    if (prepared.kind === 'issue') {
      if (
        await handleTerminalRedvaultDeliveryIssue(
          context,
          merchant,
          submissionOptions,
          prepared.issue
        )
      )
        return;
      if (prepared.issue === 'delivery-option') {
        toast({
          title: 'Select Delivery Option',
          description:
            'Please select a delivery option before placing your order.',
          variant: 'destructive',
        });
        navigation.setCurrentStep('delivery');
        navigation.setCompletedSteps((previous) => ({
          ...previous,
          delivery: false,
        }));
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
          'bank-transfer-unavailable':
            'Bank transfer is not available for this store yet. Please choose a different payment method.',
          'paystack-unavailable':
            'Paystack is not available for this store yet. Please choose a different payment method.',
          'korapay-unavailable':
            'Korapay is not available for this store yet. Please choose a different payment method.',
          'redvault-unavailable':
            'Pay with UBA is not available right now. Please choose a different payment method.',
        }[prepared.issue];
        toast({
          title: 'Payment Unavailable',
          description: message,
          variant: 'destructive',
        });
        processing.isOrderInFlightRef.current = false;
        return;
      }
      if (prepared.issue === 'klump-unavailable') {
        toast(KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST);
        processing.releaseSubmission();
        return;
      }
      if (prepared.issue === 'incomplete-address') {
        toast({
          title: 'Incomplete Address',
          description: 'Please enter your full address (Street, City, State).',
          variant: 'destructive',
        });
        processing.setIsProcessing(false);
        navigation.setCompletedSteps((previous) => ({
          ...previous,
          delivery: false,
        }));
        processing.isOrderInFlightRef.current = false;
        navigation.setCurrentStep('delivery');
        return;
      }
      if (prepared.issue === 'delivery-required') {
        toast({
          title: 'Delivery option required',
          description: 'Please select a delivery option to continue.',
          variant: 'destructive',
        });
        processing.releaseSubmission();
        return;
      }
      toast({
        title: 'Shipping rate expired',
        description: 'Please select a delivery option again.',
        variant: 'destructive',
      });
      processing.releaseSubmission();
      return;
    }

    if (await handleSharedRedvaultReview(context, merchant, prepared)) return;
    // Review the authoritative version first and bind submission to it; a
    // stale review stops so the shopper confirms changed lines before retry.
    let sharedCartBinding: SharedCartOrderBinding | null = null;
    let sharedCartSessionExpiresAtMonotonicMs: number | null = null;
    let sharedCartSessionExpiresAtEpochMs: number | null = null;
    let reviewedCheckoutItemsResult: ReturnType<
      typeof buildCheckoutOrderItems
    > | null = null;
    if (cart.sharedCartEnabled && !cart.sharedCartRef) {
      toast({
        title: 'Cart Syncing',
        description:
          'Your cart is still connecting. Wait a moment and submit again.',
        variant: 'destructive',
      });
      processing.isOrderInFlightRef.current = false;
      return;
    }
    if (cart.sharedCartRef) {
      // Wait for clean sync so order items match the pinned reviewed version.
      if (cart.sharedCartSyncStatus !== 'synced') {
        if (cart.sharedCartSyncStatus === 'error') {
          toast({
            title: 'Cart Sync Failed',
            description:
              'Your cart could not sync. Retry the sync and submit again.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Cart Syncing',
            description:
              'Your cart is still syncing. Wait a moment and submit again.',
            variant: 'destructive',
          });
        }
        processing.isOrderInFlightRef.current = false;
        return;
      }
      const review = await prepareSharedCartCheckout(
        buildSharedCartPrepareInput(cart.sharedCartRef, paymentSession.method),
        merchant?.slug
      );
      if (!review.ok) {
        if (review.code === 'refresh_required') {
          await cart.refreshSharedCart?.();
          toast({
            title: 'Cart Changed',
            description:
              'Your cart changed during checkout. Review the updated cart and submit again.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Checkout Unavailable',
            description: 'We could not review your cart. Please try again.',
            variant: 'destructive',
          });
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
        toast({
          title: 'Update Your Cart',
          description:
            'Some items are unavailable. Review your updated cart and submit again.',
          variant: 'destructive',
        });
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
        toast({
          title: 'Prices Updated',
          description:
            'Prices changed during checkout. Review the updated cart and submit again.',
          variant: 'destructive',
        });
        processing.isOrderInFlightRef.current = false;
        return;
      }
      const reviewedItems = reviewedCheckoutItems(
        cart.checkoutCart,
        review.review
      );
      if (!reviewedItems) {
        await cart.refreshSharedCart?.();
        toast({
          title: 'Cart Changed',
          description:
            'Your cart changed during checkout. Review the updated cart and submit again.',
          variant: 'destructive',
        });
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
      sharedCartSessionExpiresAtMonotonicMs =
        review.sessionExpiresAtMonotonicMs;
      sharedCartSessionExpiresAtEpochMs = review.sessionExpiresAtEpochMs;
    }

    if (
      sharedCartBinding &&
      isSharedCartCheckoutDeadlineExpired(
        sharedCartSessionExpiresAtMonotonicMs,
        sharedCartSessionExpiresAtEpochMs
      )
    ) {
      toast({
        title: 'Checkout Unavailable',
        description: 'Your checkout review expired. Please review your cart again.',
        variant: 'destructive',
      });
      processing.releaseSubmission();
      return;
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
