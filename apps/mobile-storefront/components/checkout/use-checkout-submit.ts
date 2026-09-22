import { useMerchant } from '@/hooks/use-merchant';
import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import type { ShippingAddressInput } from '@/lib/validation';
import { getFullyPaidStoreCreditPaymentMethod } from '@/lib/wallet-payment-helpers';
import { trackCheckoutStep } from '@/services/analytics';
import { createOrder } from '@/services/orders';
import { trackCheckoutRoutePurchaseCompleted } from '@/services/tiktok-checkout-route-tracking';
import { useCartStore } from '@/stores/cart-store';
import { abortIfCartPricesStale } from './abort-if-cart-prices-stale';
import { acquireCheckoutSubmitFence } from './acquire-checkout-submit-fence';
import { submitBnplCheckout } from './checkout-bnpl-submit';
import { createCheckoutSnapshot } from './checkout-order-builders';
import { runCheckoutPostOrderSideEffects } from './checkout-post-order-side-effects';
import {
  blockIfMixedPrizeCart,
  cartHasVoucherLine,
} from './checkout-prize-cart-guard';
import { CHECKOUT_MERCHANT_ID } from './checkout-screen.constants';
import { resolveCheckoutStoreCreditSelections } from './checkout-store-credit';
import { handleCheckoutSubmitError } from './checkout-submit-error';
import { buildCheckoutSubmitOrderRequest } from './checkout-submit-order-request';
import { captureCheckoutSubmitRollbackState } from './checkout-submit-rollback-state';
import { validateCheckoutSubmission } from './checkout-submit-validation';
import { isBnplPayment } from './is-bnpl-payment';
import { restoreEmptiedCheckoutCart } from './restore-emptied-checkout-cart';
import { runFinalizeCheckoutPayment } from './run-finalize-checkout-payment';
import { runRedvaultPostOrderBranch } from './run-redvault-post-order-branch';
import { trackSubmittedCheckoutGeneration } from './track-submitted-checkout-generation';
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
    // REDVAULT fence preamble (extracted): validates a possibly-stale
    // fenced order before any new order is created below. The acquire
    // helper holds the in-flight latch across the fence await and owns
    // its release on decline; the main flow below reuses the held latch
    // through its own try/finally.
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
    // The in-flight latch is already held (acquired before the fence
    // await above) and releases in the finally below.
    setIsProcessing(true);
    // Hoisted for the rollback path, which re-freezes these on cart restore.
    let submitCreditFields: Record<string, unknown> | undefined;
    let submitHadSortMarker: boolean | undefined;
    const submittedGeneration = trackSubmittedCheckoutGeneration(
      checkoutGenerationSnapshot
    );
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
      const { creditFields, orderRequest } = buildCheckoutSubmitOrderRequest({
        address,
        appliedDiscountCode,
        customerEmail,
        customerName,
        customerPhone,
        deliveryMethod,
        itemsSnapshot,
        liveSavingsSelection,
        liveWalletSelection,
        paymentMethodForOrder,
        selectedQuote,
        shippingProvider: getShippingProvider(),
        snapshot,
      });
      const orderResponse = await createOrder(orderRequest, {
        checkoutGeneration: checkoutGenerationSnapshot,
      });
      submittedGeneration.track(orderResponse);
      const rollbackState = await captureCheckoutSubmitRollbackState(
        submittedGeneration.current(),
        creditFields
      );
      submitCreditFields = rollbackState.creditFields;
      submitHadSortMarker = rollbackState.hadSortMarker;
      const { order } = orderResponse;
      const completedPaymentMethod =
        getFullyPaidStoreCreditPaymentMethod(orderResponse) ?? selectedPayment;
      const orderNumber =
        order.order_number || order.id.slice(0, 8).toUpperCase();
      if (
        await runRedvaultPostOrderBranch({
          accountPassword,
          address,
          checkoutGeneration: submittedGeneration.current(),
          completedPaymentMethod,
          customer,
          customerEmail,
          customerName,
          customerPhone,
          isAuthenticated,
          itemsSnapshot,
          onRedvaultOrder,
          order,
          orderNumber,
          orderResponse,
          saveAsDefaultAddress,
          saveDetails,
          selectedPayment,
          selectedSavedAddressId,
          snapshot,
        })
      ) {
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
        checkoutGeneration: submittedGeneration.current(),
        creditFields: submitCreditFields,
        hadSortMarker: submitHadSortMarker,
        itemsSnapshot,
      });
      handleCheckoutSubmitError(error, selectedPayment);
    } finally {
      setIsProcessing(false);
      isOrderInFlight.current = false;
    }
  };
}
