import { Alert } from 'react-native';
import { useMerchant } from '@/hooks/use-merchant';
import type { ShippingAddressInput } from '@/lib/validation';
import {
  buildSavingsOrderFields,
  buildWalletOrderFields,
  getFullyPaidStoreCreditPaymentMethod,
} from '@/lib/wallet-payment-helpers';
import { trackCheckoutStep } from '@/services/analytics';
import {
  pickChangedPriceById,
  repriceCartItems,
} from '@/services/cart-reprice';
import { createOrder } from '@/services/orders';
import { trackCheckoutRoutePurchaseCompleted } from '@/services/tiktok-checkout-route-tracking';
import { useCartStore } from '@/stores/cart-store';
import { submitBnplCheckout } from './checkout-bnpl-submit';
import {
  buildCheckoutOrderRequest,
  createCheckoutSnapshot,
} from './checkout-order-builders';
import { finalizeCheckoutPayment } from './checkout-payment-finalization';
import { runCheckoutPostOrderSideEffects } from './checkout-post-order-side-effects';
import {
  blockIfMixedPrizeCart,
  cartHasVoucherLine,
} from './checkout-prize-cart-guard';
import { CHECKOUT_MERCHANT_ID } from './checkout-screen.constants';
import { resolveCheckoutStoreCreditSelections } from './checkout-store-credit';
import { handleCheckoutSubmitError } from './checkout-submit-error';
import { validateCheckoutSubmission } from './checkout-submit-validation';
import type { UseCheckoutSubmitParams } from './use-checkout-submit.types';

export type { UseCheckoutSubmitParams };

export function useCheckoutSubmit({
  accountPassword,
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
    const checkoutGenerationSnapshot =
      useCartStore.getState().checkoutGeneration;
    const groupNegotiationSnapshot =
      useCartStore.getState().cartWideNegotiationActive;

    // Checkout-time safety net: never let a prize voucher check out alongside
    // paid items (the prize redeems on its own order and the cart is cleared).
    if (blockIfMixedPrizeCart(itemsSnapshot)) {
      return;
    }
    // A voucher-only cart (₦0 prize) must take the standard order path, which
    // returns the pre-reserved order already paid and routes to success — never
    // a BNPL/financing flow (those bypass the fully-paid route and would open a
    // ₦0 loan while leaving the voucher in the cart).
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

    isOrderInFlight.current = true;
    setIsProcessing(true);

    try {
      if (itemsSnapshot.length > 0) {
        const reprice = await repriceCartItems(itemsSnapshot, merchantId);
        if (reprice.changes.length > 0) {
          useCartStore.getState().repriceItems(pickChangedPriceById(reprice));
          Alert.alert(
            'Prices updated',
            'Some prices changed since you added these items. Your cart has been updated to the latest prices — please review the new total and tap checkout again.',
            [{ text: 'OK' }]
          );
          return;
        }
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
      const customerEmail = customer?.email || address.email;
      const customerPhone = address.phone;
      const customerName = `${address.firstName} ${address.lastName}`;
      // A voucher-only cart is a ₦0 prize: force a non-POD method so the voucher
      // RPC marks the pre-reserved order paid (it keys payment_status off
      // p_payment_method — 'pod'/'pay_on_delivery' → pending, else → paid). With
      // POD the prize order would be left pending while the cart is cleared.
      const paymentMethodForOrder = isVoucherOnlyCart
        ? 'card'
        : selectedPayment === 'payforme'
          ? 'invoice'
          : selectedPayment;
      const isBNPL =
        selectedPayment === 'credpal' ||
        selectedPayment === 'credit_direct' ||
        selectedPayment === 'klump';

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

      const orderResponse = await createOrder({
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
      });
      const { order } = orderResponse;
      const orderNumber =
        order.order_number || order.id.slice(0, 8).toUpperCase();
      const completedPaymentMethod =
        getFullyPaidStoreCreditPaymentMethod(orderResponse) ?? selectedPayment;

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

      await finalizeCheckoutPayment({
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
      const cartStore = useCartStore.getState();
      if (cartStore.items.length === 0) {
        cartStore.restoreItems(
          itemsSnapshot,
          groupNegotiationSnapshot,
          checkoutGenerationSnapshot
        );
      }
      handleCheckoutSubmitError(error, selectedPayment);
    } finally {
      setIsProcessing(false);
      isOrderInFlight.current = false;
    }
  };
}
