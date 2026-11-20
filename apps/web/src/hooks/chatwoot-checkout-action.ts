import type { ChatwootCommerceMessage } from '@/schemas/chatwoot-commerce-message';
import type { HandleChatwootCheckoutPlaceInput } from './chatwoot-checkout-place-action';
import {
  CHATWOOT_CHECKOUT_PLACE_PREFIX,
  CHATWOOT_CHECKOUT_STATUS_PREFIX,
} from './chatwoot-checkout-result';

type CheckoutMessage = Extract<
  ChatwootCommerceMessage,
  {
    event:
      | 'baci-checkout-place-request'
      | 'baci-checkout-payment-status-request';
  }
>;

export type HandleChatwootCheckoutActionInput = Omit<
  HandleChatwootCheckoutPlaceInput,
  'request' | 'postResult'
> & {
  message: CheckoutMessage;
  post: (prefix: string, value: unknown) => void;
};

/**
 * Routes an authorized in-chat checkout message. The order and payment
 * modules load on first use so storefront pages that never check out in chat
 * do not carry the checkout code in their shell bundle.
 */
export async function handleChatwootCheckoutAction({
  message,
  post,
  ...place
}: HandleChatwootCheckoutActionInput): Promise<void> {
  if (message.event === 'baci-checkout-place-request') {
    const { handleChatwootCheckoutPlace } = await import(
      './chatwoot-checkout-place-action'
    );
    await handleChatwootCheckoutPlace({
      ...place,
      request: message.data,
      postResult: (result) => post(CHATWOOT_CHECKOUT_PLACE_PREFIX, result),
    });
    return;
  }
  const { getChatwootCheckoutRememberedOrderByReference } = await import(
    './chatwoot-checkout-memory'
  );
  const unavailable = () => {
    if (place.canPost()) {
      post(CHATWOOT_CHECKOUT_STATUS_PREFIX, {
        requestId: message.data.requestId,
        status: 'unavailable',
      });
    }
  };
  // The widget's reference only selects an order this conversation placed on
  // this page; the order, token and merchant used for the poll come from page
  // memory, never from the widget.
  const entry = getChatwootCheckoutRememberedOrderByReference(
    message.data.reference
  );
  if (
    !entry?.payment ||
    entry.merchantId !== place.getMerchant()?.id ||
    entry.conversationId !== message.data.conversationId
  ) {
    return unavailable();
  }
  const { readChatwootCheckoutPaymentStatus } = await import(
    './chatwoot-checkout-payment'
  );
  const result = await readChatwootCheckoutPaymentStatus({
    requestId: message.data.requestId,
    orderId: entry.order.orderId,
    trackingToken: entry.order.trackingToken,
    merchantSlug: place.storeSlug,
    issuedAt: entry.payment.issuedAt,
  });
  if (place.canPost()) post(CHATWOOT_CHECKOUT_STATUS_PREFIX, result);
}
