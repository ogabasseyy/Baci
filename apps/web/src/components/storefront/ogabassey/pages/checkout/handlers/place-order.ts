import { isOxygenStorefrontStagingEnabled } from '@/config/oxygen-storefront-staging';
import { toast } from '@/hooks/use-toast';
import { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import {
  KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST,
  isKlumpUnavailableForGatewayAmount,
} from '../utils';
import { createPlaceOrder } from './place-order-create';
import { routePlaceOrderPayment } from './place-order-payment';
import {
  buildShippingAddress,
  getShippingProvider,
} from './place-order-shipping';
import type { PlaceOrderOptions } from './place-order-types';
export type { CheckoutCartItem, PlaceOrderOptions } from './place-order-types';

export async function handlePlaceOrder(opts: PlaceOrderOptions): Promise<void> {
  const {
    merchant,
    currency,
    customerEmail,
    firstName,
    lastName,
    customerPhone,
    deliveryMethod,
    isNewAddressMode,
    newAddressStreet,
    newAddressCity,
    newAddressState,
    cart,
    total,
    selectedQuoteId,
    shippingQuotes,
    paymentMethod,
    payWithWallet,
    walletAmountUsed,
    user,
    resumedOrder,
    preferredGateway,
    isOrderInFlightRef,
    setIsProcessing,
    setCurrentStep,
    setCompletedSteps,
    executeDirectPayment,
  } = opts;

  // Double-submit protection
  if (isOrderInFlightRef.current) return;
  isOrderInFlightRef.current = true;

  if (!merchant?.id) {
    toast({
      title: 'Error',
      description: 'Merchant context not available. Please try again.',
      variant: 'destructive',
    });
    isOrderInFlightRef.current = false;
    return;
  }

  if (!customerEmail || !firstName || !lastName) {
    toast({
      title: 'Missing Information',
      description: 'Please fill in your name and email.',
      variant: 'destructive',
    });
    isOrderInFlightRef.current = false;
    return;
  }

  if (
    paymentMethod === 'oxygen' &&
    (!isOxygenStorefrontStagingEnabled() ||
      currency !== 'NGN' ||
      !user ||
      payWithWallet)
  ) {
    toast({
      title: 'Oxygen setup unavailable',
      description:
        'Sign in and use the full order amount for this staging finance test.',
      variant: 'destructive',
    });
    isOrderInFlightRef.current = false;
    return;
  }
  setIsProcessing(true);

  // Handle resumed orders (order exists, just need payment)
  if (resumedOrder && preferredGateway) {
    await executeDirectPayment();
    return;
  }

  // Validate address for door delivery
  if (deliveryMethod === 'door' && isNewAddressMode) {
    if (!newAddressStreet || !newAddressCity || !newAddressState) {
      toast({
        title: 'Incomplete Address',
        description: 'Please enter your full address (Street, City, State).',
        variant: 'destructive',
      });
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return;
    }
  }

  const shippingAddressData = buildShippingAddress(opts);

  // B3 review fix #2 (PR #1611): block door delivery without ANY
  // selected quote BEFORE constructing the JSON body. Pre-fix, this
  // path sent `shipping_provider: null + selected_quote_id: null`,
  // which slipped past the RPC's `provider != null AND quote_id IS
  // NULL` guard (both null → guard doesn't fire) and persisted a
  // silent zero-shipping order. The RPC predicate alone cannot tell
  // legitimate "no shipping" (pickup/airport) from broken "door
  // without quote" — the client knows the deliveryMethod and is the
  // right place to enforce.
  if (
    (deliveryMethod === 'door' || deliveryMethod === 'pickup_station') &&
    !selectedQuoteId
  ) {
    toast({
      title: 'Delivery option required',
      description: 'Please select a delivery option to continue.',
      variant: 'destructive',
    });
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }

  const shippingProviderResolution = getShippingProvider(
    deliveryMethod,
    selectedQuoteId,
    shippingQuotes
  );
  if (!shippingProviderResolution.ok) {
    // B3 review fix #1: dangling selectedQuoteId (door delivery,
    // quote ref but no matching rate in the current list — usually
    // expired or refreshed under us). Surface a validation error and
    // bail instead of fabricating a 'Standard' provider; the customer
    // re-picks a quote from the freshly loaded rates.
    toast({
      title: 'Shipping rate expired',
      description: 'Please select a delivery option again.',
      variant: 'destructive',
    });
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }
  const shippingProvider = shippingProviderResolution.provider;
  const clientPayableAmount = payWithWallet ? total - walletAmountUsed : total;
  const billingAddressLine1 =
    deliveryMethod === 'door' && isNewAddressMode
      ? newAddressStreet
      : shippingAddressData.address;

  if (
    isKlumpUnavailableForGatewayAmount({
      paymentMethod,
      payableAmount: clientPayableAmount,
      orderAmount: total,
    })
  ) {
    toast(KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST);
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }

  const orderItems = buildCheckoutOrderItems(cart);

  try {
    const orderData = await createPlaceOrder(
      opts,
      merchant,
      shippingAddressData,
      shippingProvider,
      orderItems
    );
    await routePlaceOrderPayment(
      opts,
      merchant,
      orderData,
      shippingAddressData,
      billingAddressLine1,
      orderItems
    );
  } catch (error) {
    console.error('Checkout error:', error);
    toast({
      title: 'Checkout Failed',
      description:
        error instanceof Error
          ? error.message
          : 'An error occurred. Please try again.',
      variant: 'destructive',
    });
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    setCurrentStep('payment');
    setCompletedSteps({ contact: true, delivery: true });
  }
}
