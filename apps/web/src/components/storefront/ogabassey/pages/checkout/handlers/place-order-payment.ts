import { toast } from '@/hooks/use-toast';
import {
  isKlumpUnavailableForGatewayAmount,
  KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST,
} from '../utils';
import type { CheckoutOrderItem } from '@/lib/checkout/build-order-items';
import { initializeCardPayment } from './place-order-card-payment';
import { routePlaceOrderFinancing } from './place-order-financing';
import type { LegacyOrderData, PlaceOrderOptions } from './place-order-types';
import type { buildShippingAddress } from './place-order-shipping';

export async function routePlaceOrderPayment(
  opts: PlaceOrderOptions,
  merchant: NonNullable<PlaceOrderOptions['merchant']>,
  orderData: LegacyOrderData,
  shippingAddressData: ReturnType<typeof buildShippingAddress>,
  billingAddressLine1: string,
  orderItems: CheckoutOrderItem[]
): Promise<void> {
  const { order, wallet: walletResult, amountDueToGateway } = orderData;
  const {
    total,
    paymentMethod,
    setIsProcessing,
    isOrderInFlightRef,
    setWalletBalance,
    routerPush,
    getHref,
    clearCheckoutSession,
    clearCart,
    dva,
    crypto,
    customerEmail,
    customerPhone,
    firstName,
    lastName,
    cart,
    currency,
    payForMeDetails,
  } = opts;
  const paymentAmount = amountDueToGateway ?? total;
  const trackingParam = order.tracking_token
    ? `&trackingToken=${order.tracking_token}`
    : '';

  if (
    isKlumpUnavailableForGatewayAmount({
      paymentMethod,
      payableAmount: paymentAmount,
      orderAmount: total,
    })
  ) {
    toast(KLUMP_WALLET_CREDIT_UNAVAILABLE_TOAST);
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }

  if (walletResult?.amountUsed) {
    setWalletBalance(walletResult.newBalance);
  }

  if (paymentMethod === 'oxygen') {
    routerPush(`/payments/oxygen/${order.id}`);
    return;
  }

  // 2. Route to payment gateway
  if (paymentAmount <= 0) {
    clearCheckoutSession();
    routerPush(
      getHref(`/order-success?orderId=${order.id}&wallet=true${trackingParam}`)
    );
    setTimeout(clearCart, 500);
    return;
  }

  if (paymentMethod === 'bank_transfer') {
    await dva.handleBankTransfer(
      order,
      paymentAmount,
      isOrderInFlightRef,
      setIsProcessing
    );
    return;
  }

  if (paymentMethod === 'juicyway') {
    crypto.setPendingCryptoOrder({
      orderId: order.id,
      amount: paymentAmount,
      customerEmail,
      customerName: `${firstName} ${lastName}`.trim(),
      customerPhone,
      billingAddress: {
        line1: billingAddressLine1,
        city: shippingAddressData.city,
        state: shippingAddressData.state,
        country: 'NG',
        zip_code: '100001',
      },
      items: cart.map((item) => ({
        name: item.name,
        type: 'physical' as const,
      })),
      trackingToken: order.tracking_token,
    });
    crypto.setShowCryptoSelector(true);
    setIsProcessing(false);
    isOrderInFlightRef.current = false;
    return;
  }

  if (
    paymentMethod === 'paystack' ||
    paymentMethod === 'korapay' ||
    paymentMethod === 'klump'
  ) {
    const result = await initializeCardPayment(
      merchant.id,
      order.id,
      currency,
      customerEmail,
      `${firstName} ${lastName}`.trim(),
      customerPhone,
      paymentMethod,
      {
        line1: billingAddressLine1,
        city: shippingAddressData.city || 'Lagos',
        state: shippingAddressData.state || 'Lagos',
        country: 'NG',
        zip_code: '100001',
      }
    );

    if (result.crypto_payment) {
      crypto.setCryptoPaymentData({
        address: result.crypto_payment.address,
        chain: result.crypto_payment.chain,
        currency: result.crypto_payment.currency,
        amount: result.crypto_payment.amount / 100,
        confirmation_time: result.crypto_payment.confirmation_time,
        orderId: order.id,
        reference: result.reference,
        sessionId: result.session_id || '',
        paymentId: result.crypto_payment.payment_id || '',
        trackingToken: order.tracking_token,
      });
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return;
    }

    if (result.authorization_url) {
      window.location.href = result.authorization_url;
      return;
    }

    if (result.checkout_url) {
      window.location.href = result.checkout_url;
      return;
    }

    throw new Error('Payment initialization failed: No auth URL returned');
  }

  if (paymentMethod === 'credit_direct' || paymentMethod === 'credpal') {
    await routePlaceOrderFinancing(
      opts,
      merchant,
      order,
      paymentAmount,
      trackingParam,
      orderItems
    );
    return;
  }

  if (paymentMethod === 'invoice') {
    clearCheckoutSession();
    routerPush(
      getHref(`/order-success?type=invoice&orderId=${order.id}${trackingParam}`)
    );
    setTimeout(clearCart, 500);
  } else if (paymentMethod === 'payforme') {
    clearCheckoutSession();
    routerPush(
      getHref(
        `/order-success?type=payforme&orderId=${order.id}&payerName=${encodeURIComponent(payForMeDetails.name)}${trackingParam}`
      )
    );
    setTimeout(clearCart, 500);
  } else {
    // Default: POD or other
    clearCheckoutSession();
    routerPush(
      getHref(
        `/order-success?type=standard&orderId=${order.id}${trackingParam}`
      )
    );
    setTimeout(clearCart, 500);
  }
}
