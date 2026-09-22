import { useEffect, useRef } from 'react';
import { useMerchant } from '@/hooks/use-merchant';
import type { ShippingAddressInput } from '@/lib/validation';
import {
  buildSavingsOrderFields,
  buildWalletOrderFields,
} from '@/lib/wallet-payment-helpers';
import { createOrder } from '@/services/orders';
import { useCartStore } from '@/stores/cart-store';
import { acquireCheckoutSubmitFence } from './acquire-checkout-submit-fence';
import { submitBnplCheckout } from './checkout-bnpl-submit';
import { buildCheckoutCompletionAttribution } from './checkout-completion-attribution';
import { buildCheckoutOrderRequest } from './checkout-order-builders';
import { runCheckoutPostOrderSideEffects } from './checkout-post-order-side-effects';
import {
  blockIfMixedPrizeCart,
  cartHasVoucherLine,
} from './checkout-prize-cart-guard';
import { CHECKOUT_MERCHANT_ID } from './checkout-screen.constants';
import { handleCheckoutSubmitError } from './checkout-submit-error';
import { validateCheckoutSubmission } from './checkout-submit-validation';
import { handleCreatedCheckoutOrder } from './handle-created-checkout-order';
import { isBnplPayment } from './is-bnpl-payment';
import { prepareCheckoutOrderInputs } from './prepare-checkout-order-inputs';
import { restoreEmptiedCheckoutCart } from './restore-emptied-checkout-cart';
import { runFinalizeCheckoutPayment } from './run-finalize-checkout-payment';
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
  // Guards the fully-paid routing continuation: the completion-tracking
  // await can outlive checkout, and a late resolution must not erase a
  // newly created cart or navigate away from the shopper's screen.
  const isMountedRef = useRef(true);
  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    []
  );
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

    // Set once createOrder commits: post-creation failures that do record a
    // funnel failure must carry the order id so the event serializes behind
    // order_created and joins to the order. (Pre-start init failures are
    // suppressed from the funnel; the id still threads through for them.)
    let createdOrderId: string | undefined;

    try {
      const preparedOrderInputs = await prepareCheckoutOrderInputs({
        deliveryFee,
        getLiveSavingsSelection,
        isVoucherOnlyCart,
        itemsSnapshot,
        merchantId,
        orderTotals,
        paymentTab,
        selectedPayment,
        walletBalance,
        walletSelection,
      });
      if (!preparedOrderInputs) {
        return;
      }
      const {
        liveSavingsSelection,
        liveWalletSelection,
        paymentMethodForOrder,
        snapshot,
      } = preparedOrderInputs;
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
          // The Klump path creates its order inside the nested submit:
          // capture the id so a nested init failure still reports with
          // the committed order identity.
          onOrderCreated: (nestedOrderId) => {
            createdOrderId = nestedOrderId;
          },
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
        {
          analyticsPaymentMethod: selectedPayment,
          checkoutGeneration: checkoutGenerationSnapshot,
        }
      );
      const { order } = orderResponse;
      createdOrderId = order.id;
      const { handled: redvaultHandled, orderNumber } =
        await handleCreatedCheckoutOrder({
          accountPassword,
          address,
          checkoutGeneration: checkoutGenerationSnapshot,
          customer,
          customerEmail,
          customerName,
          customerPhone,
          isAuthenticated,
          itemsSnapshot,
          onRedvaultOrder,
          orderResponse,
          saveAsDefaultAddress,
          saveDetails,
          selectedPayment,
          selectedSavedAddressId,
          snapshot,
        });
      if (redvaultHandled) {
        return;
      }
      await runFinalizeCheckoutPayment({
        attribution: buildCheckoutCompletionAttribution({
          customerEmail,
          customerPhone,
          // Auth identity, not the storefront customer-row id: the server
          // conversion payload joins on external_id for cross-device ad
          // matching, and the cached auth identity must win.
          userId: user?.id ?? undefined,
          items: itemsSnapshot,
          snapshot,
        }),
        clearCart,
        customerEmail,
        customerName,
        customerPhone,
        isMountedRef,
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
      handleCheckoutSubmitError(error, selectedPayment, createdOrderId);
    } finally {
      setIsProcessing(false);
      isOrderInFlight.current = false;
    }
  };
}
