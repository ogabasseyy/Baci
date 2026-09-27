import { isWalletOrderAutoDebitWebEnabled } from '@/config/wallet-order-auto-debit';
import { toast } from '@/hooks/use-toast';
import { captureCheckoutPaymentFailed } from '../capture-checkout-payment-failed';
import { isEligibleForWalletFundedBankTransfer } from '../wallet-funded-transfer-eligibility';
import type { CheckoutPaymentDispatchContext } from './checkout-payment-dispatch-context';
import { initializeCheckoutDva } from './initialize-checkout-dva';

export async function startCheckoutBankTransfer(
  context: CheckoutPaymentDispatchContext
): Promise<void> {
  const {
    merchant,
    order,
    total,
    paymentAmount,
    createdOrderNumber,
    orderChargeCurrency,
    currencyCode,
    firstName,
    lastName,
    customerEmail,
    customerPhone,
    billingAddress,
    checkoutFingerprint,
    walletFundedTransfer,
    waitForResolvedStorefrontCustomerAuth,
    setIsProcessing,
    isOrderInFlightRef,
    setDvaData,
    setDvaCountdown,
    setIsInitializingDva,
    capturePaymentStarted,
    hasPaymentStarted,
  } = context;

  // Wallet-funded transfer FIRST for signed-in customers of an
  // auto-debit merchant (flag-gated). Clean declines resolve as `fallback`
  // and continue to the legacy order-DVA path. An `uncertain` result must
  // stop here because the funding intent may already exist.
  //
  // Await the AUTHORITATIVE session value first: the storefront session
  // fetch is async, so reading a still-`loading` state here would treat a
  // signed-in customer who submits promptly after page load as a guest and
  // route them to legacy DVA. `waitForResolvedAuthenticated` blocks on the
  // in-flight fetch (fail-closed to guest on error) so the branch decision
  // is only made once the session is known.
  const storefrontCustomerAuthenticated =
    await waitForResolvedStorefrontCustomerAuth();
  const walletFundedOutcome =
    merchant &&
    isEligibleForWalletFundedBankTransfer({
      isAuthenticated: storefrontCustomerAuthenticated,
      merchantId: merchant.id,
      orderCurrency: orderChargeCurrency,
      paymentAmount,
      walletOrderAutoDebitWebEnabled: isWalletOrderAutoDebitWebEnabled(),
    })
      ? await walletFundedTransfer.start({
          checkoutFingerprint,
          currency: orderChargeCurrency,
          merchantId: merchant.id,
          merchantSlug: merchant.slug ?? undefined,
          orderId: order.id,
          orderNumber: createdOrderNumber,
          // Canonical row total for the completion revenue (the
          // intent target is the post-savings residual).
          orderTotal: order.total ?? total,
          trackingToken: order.tracking_token,
        })
      : ('fallback' as const);

  if (
    walletFundedOutcome !== 'fallback' &&
    walletFundedOutcome !== 'uncertain'
  ) {
    // Stamp the funding-intent ID: a retried order creates a second
    // intent, and both attempts' lifecycle events must stay
    // distinguishable (the completion stamps it likewise).
    capturePaymentStarted(walletFundedOutcome.intentId);
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }

  if (walletFundedOutcome === 'uncertain') {
    // Money-safety: the create-intent POST outcome is indeterminate — the
    // server may already hold a funding intent for this order. Do NOT open
    // the legacy order-DVA path (a second funding channel risks a double
    // charge); prompt the customer to check their wallet and retry.
    toast({
      title: 'We could not confirm your transfer setup',
      description:
        'Please check your wallet balance before trying again. Do not start another payment for this order yet.',
      variant: 'destructive',
    });
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }

  await initializeCheckoutDva({
    merchantId: merchant.id,
    customerEmail,
    customerName: `${firstName} ${lastName}`.trim(),
    customerPhone,
    checkoutFingerprint,
    billingAddress,
    currencyCode,
    paymentAmount,
    total,
    order,
    setDvaData,
    setDvaCountdown,
    setIsProcessing,
    setIsInitializingDva,
    releaseSubmitLock: () => {
      isOrderInFlightRef.current = false;
    },
    onDvaReady: capturePaymentStarted,
    onPaymentFailure: () => {
      if (!hasPaymentStarted()) {
        return;
      }
      captureCheckoutPaymentFailed({
        currency: orderChargeCurrency,
        orderId: order.id,
        paymentMethod: 'bank_transfer',
        reason: 'bank_transfer_error',
        total: order.total ?? total,
      });
    },
    onError: (error) => {
      console.error('DVA initialization error:', error);
      toast({
        title: 'Bank Transfer Failed',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to initialize bank transfer',
        variant: 'destructive',
      });
    },
  });
  return;
}
