import { useIsMountedRef } from '@/components/bnpl-checkout/use-is-mounted-ref';
import { useMerchant } from '@/hooks/use-merchant';
import type { ShippingAddressInput } from '@/lib/validation';
import { getFullyPaidStoreCreditPaymentMethod } from '@/lib/wallet-payment-helpers';
import { trackCheckoutStep } from '@/services/analytics';
import { useCartStore } from '@/stores/cart-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { abortIfCartPricesStale } from './abort-if-cart-prices-stale';
import { acquireCheckoutSubmitFence } from './acquire-checkout-submit-fence';
import { submitBnplCheckout } from './checkout-bnpl-submit';
import { createCheckoutSnapshot } from './checkout-order-builders';
import {
  blockIfMixedPrizeCart,
  cartHasVoucherLine,
} from './checkout-prize-cart-guard';
import { CHECKOUT_MERCHANT_ID } from './checkout-screen.constants';
import { resolveCheckoutStoreCreditSelections } from './checkout-store-credit';
import { handleCheckoutSubmitError } from './checkout-submit-error';
import { createSubmittedOrderIdentity } from './checkout-submit-order-identity';
import { tryCaptureCheckoutSubmitRollbackState } from './checkout-submit-rollback-state';
import { validateCheckoutSubmission } from './checkout-submit-validation';
import { completeOxygenCheckout } from './complete-oxygen-checkout';
import { completeSubmittedOrder } from './complete-submitted-order';
import { createSubmittedCheckoutOrder } from './create-submitted-checkout-order';
import { isBnplPayment } from './is-bnpl-payment';
import { resolveSharedCartCheckoutBinding } from './resolve-shared-cart-checkout-binding';
import { restoreEmptiedCheckoutCart } from './restore-emptied-checkout-cart';
import { trackSubmittedCheckoutGeneration } from './track-submitted-checkout-generation';
import type { UseCheckoutSubmitParams } from './use-checkout-submit.types';

export type { UseCheckoutSubmitParams };
export function useCheckoutSubmit({
  accountPassword,
  onRedvaultOrder,
  onShippingQuoteRejected,
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
  setStep,
  walletBalance,
  walletSelection,
  ...finalization
}: UseCheckoutSubmitParams) {
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id || CHECKOUT_MERCHANT_ID;
  const isMountedRef = useIsMountedRef();
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
    // The REDVAULT fence holds the in-flight latch until completion.
    const submitFence = await acquireCheckoutSubmitFence({
      accountPassword,
      address,
      clearCart,
      customer,
      isAuthenticated,
      isOrderInFlight,
      onRedvaultOrder,
      saveAsDefaultAddress,
      saveDetails,
      selectedPayment,
      selectedSavedAddressId,
    });
    if (!submitFence) {
      return;
    }
    const { customerEmail, customerName, customerPhone } = submitFence;
    setIsProcessing(true);
    const orderIdentity = createSubmittedOrderIdentity();
    // Hoisted for the rollback path, which re-freezes these on cart restore.
    let submitCreditFields: Record<string, unknown> | undefined;
    let submitHadSortMarker: boolean | undefined;
    // Inconclusive marker read: the catch path skips cleanup.
    let rollbackCaptureInconclusive = false;
    const submittedGeneration = trackSubmittedCheckoutGeneration(
      checkoutGenerationSnapshot
    );
    try {
      if (
        !useNativeSharedCartStore.getState().enabled &&
        (await abortIfCartPricesStale(itemsSnapshot, merchantId))
      ) {
        return;
      }
      const resolvedBinding = resolveSharedCartCheckoutBinding({
        itemsSnapshot,
        setStep,
      });
      if (!resolvedBinding) {
        return;
      }
      const sharedCartBinding = resolvedBinding.binding;
      const boundItemsSnapshot = resolvedBinding.items;
      const snapshot = createCheckoutSnapshot(
        boundItemsSnapshot,
        deliveryFee,
        orderTotals?.taxAmount ?? 0
      );
      const { liveSavingsSelection, liveWalletSelection } =
        resolveCheckoutStoreCreditSelections({
          getLiveSavingsSelection,
          itemsSnapshot: boundItemsSnapshot,
          paymentTab,
          selectedPayment,
          snapshotTotal: snapshot.total,
          walletBalance,
          walletSelection,
        });
      trackCheckoutStep('review');
      // Preserve Pay-for-me identity for its documents and server dispatch.
      const paymentMethodForOrder =
        selectedPayment === 'oxygen'
          ? 'oxygen'
          : isVoucherOnlyCart
            ? 'card'
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
          itemsSnapshot: boundItemsSnapshot,
          sharedCartBinding,
          liveSavingsSelection,
          liveWalletSelection,
          checkoutGeneration: checkoutGenerationSnapshot,
          mobileCheckoutIdempotencyRef,
          onOrderCreated: orderIdentity.captureCreatedOrder,
          paymentMethodForOrder,
          paymentSettings,
          selectedPayment,
          selectedQuote,
          setIsProcessing,
          snapshot,
        });
        return;
      }
      const { creditFields, orderResponse } =
        await createSubmittedCheckoutOrder(
          {
            address,
            appliedDiscountCode,
            customerEmail,
            customerName,
            customerPhone,
            deliveryMethod,
            itemsSnapshot: boundItemsSnapshot,
            liveSavingsSelection,
            liveWalletSelection,
            paymentMethodForOrder,
            selectedQuote,
            shippingProvider: getShippingProvider(),
            snapshot,
            sharedCartBinding,
          },
          {
            checkoutGeneration: checkoutGenerationSnapshot,
            isAuthenticated,
            hasVoucher: isVoucherOnlyCart,
            hasCredits:
              walletSelection?.use === true ||
              liveSavingsSelection?.use === true,
          }
        );
      orderIdentity.captureCreatedOrder(orderResponse.order.id);
      submittedGeneration.track(orderResponse);
      const rollbackCapture = await tryCaptureCheckoutSubmitRollbackState(
        submittedGeneration.current(),
        creditFields
      );
      if (!rollbackCapture.ok) {
        // Preserve the order and cart when rollback metadata is inconclusive.
        rollbackCaptureInconclusive = true;
        throw new Error(
          'Checkout verification timed out; your cart is unchanged.'
        );
      }
      submitCreditFields = rollbackCapture.creditFields;
      submitHadSortMarker = rollbackCapture.hadSortMarker;
      const { order } = orderResponse;
      if (selectedPayment === 'oxygen') {
        await completeOxygenCheckout({
          clearCart,
          generation: submittedGeneration.current(),
          itemsSnapshot,
          orderId: order.id,
          sharedCartBinding,
        });
        return;
      }
      const completedPaymentMethod =
        getFullyPaidStoreCreditPaymentMethod(orderResponse) ?? selectedPayment;
      const orderNumber =
        order.order_number || order.id.slice(0, 8).toUpperCase();
      if (
        await completeSubmittedOrder({
          accountPassword,
          address,
          checkoutGeneration: submittedGeneration.current(),
          clearCart,
          completedPaymentMethod,
          customer,
          customerEmail,
          customerName,
          customerPhone,
          isAuthenticated,
          isMountedRef,
          isOrderInFlight,
          itemsSnapshot: boundItemsSnapshot,
          merchantId,
          onRedvaultOrder,
          order,
          orderNumber,
          orderResponse,
          saveAsDefaultAddress,
          saveDetails,
          selectedPayment,
          selectedSavedAddressId,
          setIsProcessing,
          snapshot,
          ...finalization,
        })
      ) {
        return;
      }
    } catch (error) {
      if (!rollbackCaptureInconclusive) {
        await restoreEmptiedCheckoutCart({
          cartWideNegotiationActive: groupNegotiationSnapshot,
          checkoutGeneration: submittedGeneration.current(),
          creditFields: submitCreditFields,
          hadSortMarker: submitHadSortMarker,
          itemsSnapshot,
        });
      }
      const orderId = orderIdentity.createdOrderId;
      if (onShippingQuoteRejected && isMountedRef.current) {
        handleCheckoutSubmitError(
          error,
          selectedPayment,
          orderId,
          onShippingQuoteRejected
        );
      } else {
        handleCheckoutSubmitError(error, selectedPayment, orderId);
      }
    } finally {
      setIsProcessing(false);
      isOrderInFlight.current = false;
    }
  };
}
