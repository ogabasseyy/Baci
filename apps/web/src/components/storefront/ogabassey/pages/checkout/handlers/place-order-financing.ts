import { toast } from '@/hooks/use-toast';
import { toCreditDirectItems } from '@/lib/checkout/credit-direct-items';
import { openCredPalCheckout } from '@/lib/credpal';
import { openCreditDirectCheckout } from '@/lib/credit-direct-client';
import { writeCreditDirectPopupMarker } from '../credit-direct-popup-return';
import { captureCreditDirectClientCompletion } from '../credit-direct-client-completion';
import { persistCreditDirectPopupReference } from '../persist-credit-direct-popup-reference';
import type { CheckoutOrderItem } from '@/lib/checkout/build-order-items';
import type { LegacyPlacedOrder, PlaceOrderOptions } from './place-order-types';

export async function routePlaceOrderFinancing(
  opts: PlaceOrderOptions,
  merchant: NonNullable<PlaceOrderOptions['merchant']>,
  order: LegacyPlacedOrder,
  paymentAmount: number,
  trackingParam: string,
  orderItems: CheckoutOrderItem[]
): Promise<boolean> {
  const {
    paymentMethod,
    cart,
    resumedOrder,
    customerEmail,
    customerPhone,
    firstName,
    lastName,
    clearCheckoutSession,
    clearCart,
    routerPush,
    getHref,
    setIsProcessing,
    isOrderInFlightRef,
  } = opts;
  if (paymentMethod === 'credit_direct') {
    // Weight the Credit Direct allocation by CANONICAL order-item prices
    // (negotiated applied, quiz vouchers 0), never the raw cart price — a
    // display price would finance a voucher item and under-allocate a paid
    // one. The resumed-order branch already carries persisted canonical prices.
    const items =
      cart.length > 0
        ? toCreditDirectItems(orderItems)
        : (resumedOrder?.items ?? []).map((item) => ({
            id: item.product_id,
            name: item.product_name,
            price: item.price,
            quantity: item.quantity,
          }));

    await openCreditDirectCheckout({
      merchantSlug: merchant.slug || '',
      orderId: order.id,
      trackingToken: order.tracking_token ?? '',
      amount: paymentAmount,
      customerEmail,
      customerPhone,
      customerName: `${firstName} ${lastName}`.trim(),
      items,
      onSuccess: ({ checkoutTransactionId, sessionId }) => {
        const completionMarker = captureCreditDirectClientCompletion({
          orderId: order.id,
          checkoutTransactionId,
          customerEmail,
          sessionId,
          trackingToken: order.tracking_token,
        });
        const verificationQuery = new URLSearchParams({
          orderId: order.id,
          gateway: 'credit_direct',
          merchant_slug: merchant.slug || '',
        });
        verificationQuery.set(
          'creditDirectCompletion',
          completionMarker.transactionId
        );
        if (order.tracking_token) {
          verificationQuery.set('trackingToken', order.tracking_token);
        }
        if (customerEmail) {
          verificationQuery.set('email', customerEmail);
        }
        routerPush(getHref(`/checkout/bnpl?${verificationQuery.toString()}`));
      },
      onError: (error) => {
        console.error('Credit Direct error:', error);
        toast({
          title: 'Credit Direct Failed',
          description:
            error || 'Credit Direct checkout failed. Please try again.',
          variant: 'destructive',
        });
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
      },
      onClose: () => {
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
      },
      onPopup: async ({ checkoutTransactionId, sessionId }) => {
        writeCreditDirectPopupMarker(
          order.id,
          checkoutTransactionId || sessionId
        );
        if (!checkoutTransactionId) {
          return;
        }
        try {
          await persistCreditDirectPopupReference(order, checkoutTransactionId);
        } catch (error) {
          console.error(
            'Failed to persist Credit Direct popup reference:',
            error instanceof Error ? error.message : error
          );
        }
      },
    });
    return true;
  }

  if (paymentMethod === 'credpal') {
    const credpalKey = process.env.NEXT_PUBLIC_CREDPAL_KEY;
    if (!credpalKey) {
      toast({
        title: 'CredPal Unavailable',
        description:
          'CredPal payment is not available at this time. Please select a different payment method.',
        variant: 'destructive',
      });
      setIsProcessing(false);
      isOrderInFlightRef.current = false;
      return true;
    }

    await openCredPalCheckout({
      key: credpalKey,
      amount: paymentAmount,
      product: cart.map((item) => item.name).join(', '),
      customerEmail,
      customerName: `${firstName} ${lastName}`.trim(),
      customerPhone,
      onSuccess: (data) => {
        clearCheckoutSession();
        clearCart();
        routerPush(
          getHref(
            `/order-success?type=credpal&orderId=${order.id}&credpalRef=${data.order_no}${trackingParam}`
          )
        );
      },
      onError: (error: { message?: string }) => {
        console.error('CredPal error:', error);
        toast({
          title: 'CredPal Failed',
          description:
            error.message || 'CredPal checkout failed. Please try again.',
          variant: 'destructive',
        });
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
      },
      onClose: () => {
        setIsProcessing(false);
        isOrderInFlightRef.current = false;
      },
    });
    return true;
  }

  return false;
}
