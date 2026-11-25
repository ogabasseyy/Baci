import type { ChatwootCommerceMessage } from '@/schemas/chatwoot-commerce-message';
import type { ChatwootCheckoutRememberedOrder } from './chatwoot-checkout-memory';
import { answerChatwootCheckoutReplay } from './chatwoot-checkout-replay-answer';
import { decideChatwootCheckoutReplay } from './chatwoot-checkout-replay-decision';
import type {
  ChatwootCheckoutFailureCode,
  ChatwootCheckoutPlaceResult,
} from './chatwoot-checkout-result';
import { startChatwootCheckoutPayment } from './chatwoot-checkout-start-payment';

type PlaceData = Extract<
  ChatwootCommerceMessage,
  { event: 'baci-checkout-place-request' }
>['data'];

export async function handleChatwootRememberedOrderReplay(input: {
  remembered: ChatwootCheckoutRememberedOrder;
  request: PlaceData;
  merchantId: string;
  isOxygen: boolean;
  paymentBase: {
    request: PlaceData;
    merchantId: string;
    storeSlug: string;
    orderKey: string;
    canPost: () => boolean;
    postResult: (result: ChatwootCheckoutPlaceResult) => void;
  };
  postOxygenHandoff: (orderId: string) => void;
  fail: (code: ChatwootCheckoutFailureCode) => void;
}): Promise<void> {
  const {
    remembered,
    request,
    merchantId,
    isOxygen,
    paymentBase,
    postOxygenHandoff,
    fail,
  } = input;
  const replay = decideChatwootCheckoutReplay(remembered, {
    requestId: request.requestId,
    conversationId: request.conversationId,
    merchantId,
  });
  if (
    replay.kind === 'refuse' ||
    isOxygen !== (remembered.order.paymentMethod === 'oxygen')
  ) {
    fail('order_failed');
    return;
  }
  if (isOxygen) {
    postOxygenHandoff(remembered.order.orderId);
    return;
  }
  if (replay.kind === 'answer') {
    const answer = await answerChatwootCheckoutReplay({
      cached: replay.result,
      order: remembered.order,
      storeSlug: paymentBase.storeSlug,
      issuedAt: remembered.payment?.issuedAt ?? 0,
    });
    if (paymentBase.canPost()) paymentBase.postResult(answer);
    return;
  }
  await startChatwootCheckoutPayment({
    ...paymentBase,
    order: replay.order,
    replacesExpiredDetails: remembered.payment !== null,
  });
}
