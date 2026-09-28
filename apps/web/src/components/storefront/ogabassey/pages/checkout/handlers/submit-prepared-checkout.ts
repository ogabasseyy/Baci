import { captureCheckoutPaymentStarted } from '../capture-checkout-payment-started';
import {
  clearCheckoutIdempotencyKey,
  getCheckoutIdempotencyKey,
} from '../checkout-idempotency';
import { getCheckoutOrderErrorMessage } from '../checkout-order-error-message';
import { rotateCheckoutAttemptGeneration } from '../checkout-attempt-generation';
import { signUpCheckoutCustomer } from './sign-up-checkout-customer';
import { submitFreshCheckout } from './submit-fresh-checkout';
import type { CheckoutOrderSubmissionContext } from '../hooks/checkout-order-submission-types';
import type { PrepareCheckoutOrderSubmissionResult } from '../prepare-checkout-order-submission';
import type { MerchantData } from '@/hooks/merchant/types';

type ReadySubmission = Extract<PrepareCheckoutOrderSubmissionResult, { kind: 'ready' }>;

/** Bind the prepared order snapshot to the existing fresh-order/payment lifecycle. */
export async function submitPreparedCheckout(
  context: CheckoutOrderSubmissionContext & { merchant: MerchantData },
  prepared: ReadySubmission
): Promise<void> {
  const { account, cart, contact, delivery, merchant, navigation, order, payment, processing } = context;
  const { session: paymentSession } = payment;
  const { method: paymentMethod, total, wallet, redvault } = paymentSession;
  const { items: orderItems, checkoutFingerprint } = prepared.identity;
  const { firstName, lastName, customerEmail, customerPhone, newsletterOptIn } = contact;
  const customerName = `${firstName} ${lastName}`.trim();
  const { currencyCode } = payment;

  processing.setIsProcessing(true);
  await submitFreshCheckout({
    redvaultPrepared: {
      paymentMethod,
      redvaultOrderReady: redvault.orderReady,
      checkoutFingerprint,
      waitForResolvedStorefrontCustomerAuth: account.waitForResolvedCustomerAuth,
      isOrderInFlightRef: processing.isOrderInFlightRef,
      setIsProcessing: processing.setIsProcessing,
      setRedvaultStatus: redvault.setStatus,
      setRedvaultOrderReady: redvault.setOrderReady,
      clearPendingCheckoutOrder: order.clearPending,
      createAccount: account.createAccount,
      user: account.user,
      accountPassword: account.password,
      firstName,
      lastName,
      merchantId: merchant?.id ?? '',
    },
    onRedvaultPaymentStarted: ({ orderId, currency, reference, total: paymentTotal, orderNumber }) => {
      captureCheckoutPaymentStarted({
        currency,
        orderId,
        orderNumber,
        paymentMethod: 'uba_redvault',
        reference,
        total: paymentTotal,
      });
    },
    lifecycle: {
      prepared,
      state: {
        pendingOrder: order.pending,
        merchant,
        customer: {
          email: customerEmail,
          phone: customerPhone,
          name: customerName,
          firstName,
          lastName,
          userId: account.user?.id,
        },
        newsletterOptIn,
        paymentMethod,
        total,
        orderRequestSubtotal: cart.checkoutCartTotal,
        subtotal: delivery.effectiveItemSubtotal,
        shipping: delivery.session.cost,
        tax: delivery.taxAmount,
        giftWrappingCost: delivery.giftWrappingCost,
        discountAmount: paymentSession.checkoutValues.discountAmount,
        discountCode: paymentSession.checkoutValues.discountCode,
        useWalletCredit: paymentSession.checkoutValues.useWalletCredit,
        walletAmountUsed: wallet.amountUsed,
        currency: currencyCode,
        deliveryMethod: delivery.method,
        airportType: delivery.airportType,
        selectedQuoteId: delivery.session.quotes.selectedId,
        selectedQuoteMatchesMethod: delivery.session.quotes.matchesSelectedMethod,
        merchantCountry: delivery.merchantCountry,
      },
      actions: {
        getIdempotencyKey: () => getCheckoutIdempotencyKey(checkoutFingerprint),
        cart: cart.cart,
        removeFromCart: cart.removeFromCart,
        clearPendingCheckoutOrder: order.clearPending,
        clearCheckoutIdempotencyKey: () => clearCheckoutIdempotencyKey(checkoutFingerprint),
        onShippingRateRejected: raiseCheckoutError,
        getOrderErrorMessage: getCheckoutOrderErrorMessage,
        waitForResolvedCustomerAuth: account.waitForResolvedCustomerAuth,
        isOrderInFlightRef: processing.isOrderInFlightRef,
        setIsProcessing: processing.setIsProcessing,
        setRedvaultStatus: redvault.setStatus,
        clearCheckoutSession: order.clearCheckoutSession,
        clearCart: cart.clearCart,
        pushSuccessRoute: (path) => navigation.pushSuccessRoute(navigation.getHref(path)),
        onRedvaultSummary: redvault.setSummary,
        onOrderCreated: () => {
          rotateCheckoutAttemptGeneration();
          order.setOrderCreated(true);
        },
        onPendingSnapshot: order.setPending,
        setRedvaultOrderReady: redvault.setOrderReady,
        releaseSubmission: processing.releaseSubmission,
      },
      redvault: {
        enabled: paymentMethod === 'uba_redvault' && !redvault.orderReady,
        customerName,
      },
    },
    createPaymentOptions: (lifecycle) => {
      const {
        order: createdOrder,
        wallet: walletResult,
        amountDueToGateway,
        createdOrderNumber,
        orderChargeCurrency,
        billingAddress,
      } = lifecycle;
      const signupAttempt = { current: false };
      const signUpCustomer = (logSuccess = false) =>
        signUpCheckoutCustomer({
          attempt: signupAttempt,
          enabled: account.createAccount,
          hasUser: Boolean(account.user),
          password: account.password,
          email: customerEmail,
          firstName,
          lastName,
          phone: customerPhone,
          logSuccess,
        });
      return {
        dispatch: {
          merchant,
          paymentMethod,
          total,
          currencyCode,
          firstName,
          lastName,
          customerEmail,
          customerPhone,
          billingAddress,
          checkoutFingerprint,
          checkoutCart: cart.checkoutCart,
          cart: cart.cart,
          orderItems,
          walletFundedTransfer: order.walletFundedTransfer,
          waitForResolvedStorefrontCustomerAuth: account.waitForResolvedCustomerAuth,
          setIsProcessing: processing.setIsProcessing,
          isOrderInFlightRef: processing.isOrderInFlightRef,
          setDvaData: order.setDvaData,
          setDvaCountdown: order.setDvaCountdown,
          setIsInitializingDva: order.setIsInitializingDva,
          setRedvaultStatus: redvault.setStatus,
          setPendingCryptoOrder: order.setPendingCryptoOrder,
          setShowCryptoSelector: order.setShowCryptoSelector,
          setCryptoPaymentData: order.setCryptoPaymentData,
          clearPendingCheckoutOrder: order.clearPending,
          clearCheckoutSession: order.clearCheckoutSession,
          clearCart: cart.clearCart,
          navigate: (path) => navigation.pushSuccessRoute(navigation.getHref(path)),
          redirect: (url) => window.location.assign(url),
          payForMeDetails: paymentSession.payForMe.details,
        },
        order: createdOrder,
        wallet: walletResult,
        amountDueToGateway,
        createdOrderNumber,
        orderChargeCurrency,
        checkoutFingerprint,
        paymentMethod,
        setWalletBalance: wallet.setBalance,
        capturePaymentStarted: (reference?: string) => {
          captureCheckoutPaymentStarted({
            currency: orderChargeCurrency,
            orderId: createdOrder.id,
            orderNumber: createdOrderNumber,
            paymentMethod,
            reference,
            total: createdOrder.total ?? total,
          });
        },
        completeSignup: signUpCustomer,
        signupBeforePayment:
          paymentMethod !== 'uba_redvault' &&
          account.createAccount &&
          !account.user &&
          account.password.length >= 6
            ? () => signUpCustomer(true)
            : undefined,
        releaseSubmission: processing.releaseSubmission,
      };
    },
    handleError: processing.handleSubmissionError,
  });
}

function raiseCheckoutError(): never {
  throw new Error('Shipping cost changed — please refresh and try again.');
}
