import { Alert } from 'react-native';
import { useMerchant } from '@/hooks/use-merchant';
import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import type { ShippingAddressInput } from '@/lib/validation';
import {
  buildSavingsOrderFields,
  buildWalletOrderFields,
  getFullyPaidStoreCreditPaymentMethod,
} from '@/lib/wallet-payment-helpers';
import { trackCheckoutStep } from '@/services/analytics';
import { createOrder } from '@/services/orders';
import { trackCheckoutRoutePurchaseCompleted } from '@/services/tiktok-checkout-route-tracking';
import { useCartStore } from '@/stores/cart-store';
import { abortIfCartPricesStale } from './abort-if-cart-prices-stale';
import { attachRedvaultGuestOrderAfterSignup } from './attach-redvault-guest-order';
import { submitBnplCheckout } from './checkout-bnpl-submit';
import {
  buildCheckoutOrderRequest,
  createCheckoutSnapshot,
} from './checkout-order-builders';
import { runCheckoutPostOrderSideEffects } from './checkout-post-order-side-effects';
import {
  blockIfMixedPrizeCart,
  cartHasVoucherLine,
} from './checkout-prize-cart-guard';
import { CHECKOUT_MERCHANT_ID } from './checkout-screen.constants';
import { resolveCheckoutStoreCreditSelections } from './checkout-store-credit';
import { handleCheckoutSubmitError } from './checkout-submit-error';
import { validateCheckoutSubmission } from './checkout-submit-validation';
import { isBnplPayment } from './is-bnpl-payment';
import {
  resolveCheckoutRedvaultFence,
  routeToPaidFenceOrder,
} from './resolve-checkout-redvault-fence';
import { resolveRedvaultFenceForResubmit } from './resolve-redvault-resubmit-fence';
import { restoreEmptiedCheckoutCart } from './restore-emptied-checkout-cart';
import { runFinalizeCheckoutPayment } from './run-finalize-checkout-payment';
import { submitRedvaultCheckout } from './submit-redvault-checkout';
import type { UseCheckoutSubmitParams } from './use-checkout-submit.types';

export type { UseCheckoutSubmitParams };
export function useCheckoutSubmit({
  accountPassword,
  onRedvaultOrder,
  appliedDiscountCode,
  availablePaymentMethods,
  clearCart,
  currentShippingQuoteContextKey,
  customer,
  deliveryFee,
  deliveryMethod,
  getLiveSavingsSelection,
  getShippingProvider,
  isAuthenticated,
  isLoadingQuotes,
  isOrderInFlight,
  isProcessing,
  mobileCheckoutIdempotencyRef,
  orderTotals,
  paymentSettings,
  paymentTab,
  resolvedShippingQuoteContextKey,
  requiresShippingQuote,
  saveAsDefaultAddress,
  saveDetails,
  selectedPayment,
  selectedQuote,
  selectedSavedAddressId,
  setIsProcessing,
  setPendingOrder,
  setShowCryptoSelection,
  setStep,
  user,
  walletBalance,
  walletFundedBankTransferOptionEnabled,
  walletSelection,
}: UseCheckoutSubmitParams) {
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id || CHECKOUT_MERCHANT_ID;
  return async (address: ShippingAddressInput) => {
    const itemsSnapshot = [...useCartStore.getState().items];
    const {
      checkoutGeneration: checkoutGenerationSnapshot,
      cartWideNegotiationActive: groupNegotiationSnapshot,
    } = useCartStore.getState();
    if (blockIfMixedPrizeCart(itemsSnapshot)) {
      return;
    }
    const isVoucherOnlyCart = cartHasVoucherLine(itemsSnapshot);
    if (
      !validateCheckoutSubmission({
        availablePaymentMethods,
        currentShippingQuoteContextKey,
        deliveryMethod,
        isLoadingQuotes,
        isOrderInFlight,
        isProcessing,
        itemsLength: itemsSnapshot.length,
        requiresShippingQuote,
        resolvedShippingQuoteContextKey,
        selectedPayment,
        selectedQuote,
        setStep,
      }) ||
      !selectedPayment ||
      !paymentTab
    ) {
      return;
    }
    if (selectedPayment === 'uba_redvault' && !onRedvaultOrder) {
      Alert.alert(
        'Unable to continue',
        'UBA payment review is unavailable. Please choose another payment method.'
      );
      return;
    }
    // Hoisted for fence resolution: the REDVAULT resubmit path replays a
    // live fenced order (which needs the customer identity) before any new
    // order is created below.
    const customerEmail = customer?.email || address.email;
    const customerPhone = address.phone;
    const customerName = `${address.firstName} ${address.lastName}`;
    if (selectedPayment !== 'uba_redvault') {
      // After an app kill the in-memory review is gone while the order
      // still fences inventory (and may capture): validate first.
      const fence = await resolveCheckoutRedvaultFence();
      if (!fence.proceed) {
        return;
      }
      if (fence.paidOrderId) {
        await routeToPaidFenceOrder({
          clearCart,
          orderId: fence.paidOrderId,
          orderNumber: fence.paidOrderNumber,
          trackingToken: fence.paidTrackingToken,
        });
        return;
      }
    } else {
      // REDVAULT submits must resolve the fence too: a restarted app may
      // resubmit with a changed cart or checkout generation, which derives
      // a different suffixed idempotency key and would otherwise open a
      // second inventory-reserving order while the first may still capture.
      const disposition = await resolveRedvaultFenceForResubmit({
        attemptGuestAttach:
          !isAuthenticated && saveDetails && accountPassword.length >= 6,
        clearCart,
        customerEmail,
        customerName,
        customerPhone,
        onInitializationSuccess: async () => {
          // Awaited: the resubmit flow attaches the guest order after this
          // resolves, so the signup must be complete first.
          await runCheckoutPostOrderSideEffects({
            accountPassword,
            address,
            customerEmail,
            customerId: customer?.id,
            isAuthenticated,
            saveAsDefaultAddress,
            saveDetails,
            selectedSavedAddressId,
          });
        },
      });
      if (disposition !== 'proceed') {
        return;
      }
    }
    isOrderInFlight.current = true;
    setIsProcessing(true);
    try {
      if (await abortIfCartPricesStale(itemsSnapshot, merchantId)) {
        return;
      }
      const snapshot = createCheckoutSnapshot(
        itemsSnapshot,
        deliveryFee,
        orderTotals?.taxAmount ?? 0
      );
      const { liveSavingsSelection, liveWalletSelection } =
        resolveCheckoutStoreCreditSelections({
          getLiveSavingsSelection,
          itemsSnapshot,
          paymentTab,
          selectedPayment,
          snapshotTotal: snapshot.total,
          walletBalance,
          walletSelection,
        });
      trackCheckoutStep('review');
      const paymentMethodForOrder = isVoucherOnlyCart
        ? 'card'
        : selectedPayment === 'payforme'
          ? 'invoice'
          : selectedPayment;
      const isBNPL = isBnplPayment(selectedPayment);
      if (isBNPL && !isVoucherOnlyCart) {
        await submitBnplCheckout({
          address,
          appliedDiscountCode,
          customerEmail,
          customerName,
          customerPhone,
          deliveryMethod,
          getShippingProvider,
          isOrderInFlight,
          itemsSnapshot,
          liveSavingsSelection,
          liveWalletSelection,
          checkoutGeneration: checkoutGenerationSnapshot,
          mobileCheckoutIdempotencyRef,
          paymentMethodForOrder,
          paymentSettings,
          selectedPayment,
          selectedQuote,
          setIsProcessing,
          snapshot,
        });
        return;
      }
      const orderResponse = await createOrder(
        {
          ...buildCheckoutOrderRequest({
            address,
            customerEmail,
            customerName,
            customerPhone,
            deliveryMethod,
            discountCode: appliedDiscountCode,
            itemsSnapshot,
            paymentMethodForOrder,
            selectedQuote,
            shippingProvider: getShippingProvider(),
            snapshot,
          }),
          ...(appliedDiscountCode
            ? {}
            : buildSavingsOrderFields(liveSavingsSelection)),
          ...buildWalletOrderFields(liveWalletSelection),
        },
        { checkoutGeneration: checkoutGenerationSnapshot }
      );
      const { order } = orderResponse;
      const completedPaymentMethod =
        getFullyPaidStoreCreditPaymentMethod(orderResponse) ?? selectedPayment;
      const orderNumber =
        order.order_number || order.id.slice(0, 8).toUpperCase();
      if (selectedPayment === 'uba_redvault') {
        await submitRedvaultCheckout({
          checkoutGeneration: checkoutGenerationSnapshot,
          customerEmail,
          customerName,
          customerPhone,
          onInitializationSuccess: async () => {
            await runCheckoutPostOrderSideEffects({
              accountPassword,
              address,
              customerEmail,
              customerId: customer?.id,
              isAuthenticated,
              saveAsDefaultAddress,
              saveDetails,
              selectedSavedAddressId,
            });
            // A guest signup above changed the auth identity after the
            // application was created with a null user_id: attach it so an
            // interrupted checkout can still replay or verify under the new
            // session.
            if (
              !isAuthenticated &&
              saveDetails &&
              accountPassword.length >= 6
            ) {
              await attachRedvaultGuestOrderAfterSignup({ orderId: order.id });
            }
          },
          onRedvaultOrder,
          orderResponse,
          trackingContext: {
            customerEmail,
            customerPhone,
            items: itemsSnapshot,
            orderNumber,
            paymentMethod: completedPaymentMethod,
            shipping: snapshot.deliveryFee,
            subtotal: snapshot.subtotal,
            tax: snapshot.taxAmount,
            total: order.total,
            userId: customer?.id ?? undefined,
          },
        });
        return;
      }
      if (await claimCheckoutPurchaseTracking(order.id)) {
        void trackCheckoutRoutePurchaseCompleted({
          customerEmail,
          customerPhone,
          items: itemsSnapshot,
          orderId: order.id,
          orderNumber,
          paymentMethod: completedPaymentMethod,
          shipping: snapshot.deliveryFee,
          subtotal: snapshot.subtotal,
          tax: snapshot.taxAmount,
          total: order.total,
          userId: user?.id ?? undefined,
        });
      }
      await runFinalizeCheckoutPayment({
        clearCart,
        customerEmail,
        customerName,
        customerPhone,
        isOrderInFlight,
        orderNumber,
        orderResponse,
        runPostOrderSideEffects: () => {
          void runCheckoutPostOrderSideEffects({
            accountPassword,
            address,
            customerEmail,
            customerId: customer?.id,
            isAuthenticated,
            saveAsDefaultAddress,
            saveDetails,
            selectedSavedAddressId,
          });
        },
        selectedPayment,
        setIsProcessing,
        setPendingOrder,
        setShowCryptoSelection,
        shouldCreateWalletFundedBankTransferOrder:
          walletFundedBankTransferOptionEnabled &&
          selectedPayment === 'bank_transfer',
      });
    } catch (error) {
      await restoreEmptiedCheckoutCart({
        cartWideNegotiationActive: groupNegotiationSnapshot,
        checkoutGeneration: checkoutGenerationSnapshot,
        itemsSnapshot,
      });
      handleCheckoutSubmitError(error, selectedPayment);
    } finally {
      setIsProcessing(false);
      isOrderInFlight.current = false;
    }
  };
}
