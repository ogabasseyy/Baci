import { postChatwootBridgeJson } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-request';
import {
  getSubdivisions,
  resolveSubdivisionCode,
} from '@/lib/shipping/merchant-rates/subdivisions';
import { chatwootDeliveryOptionsResponseSchema } from '@/schemas/chatwoot-delivery-options';

type CartSnapshot = {
  cartVersion: number;
  currency: string;
  estimatedTotals: boolean;
  itemsSubtotalMinor: number;
};

type CartRef = { cartId: string; version: number } | null;

interface HandleChatwootDeliveryOptionsActionInput {
  requestId: string;
  conversationId: number;
  sessionToken: string;
  state: string;
  storeSlug: string;
  snapshot: CartSnapshot;
  requestedCartRef: CartRef;
  getCurrentCartRef: () => CartRef;
  isCurrent: () => boolean;
  postResult: (result: Record<string, unknown>) => void;
}

function postUnavailable(
  requestId: string,
  postResult: HandleChatwootDeliveryOptionsActionInput['postResult']
) {
  postResult({ requestId, status: 'unavailable' });
}

export async function handleChatwootDeliveryOptionsAction({
  requestId,
  conversationId,
  sessionToken,
  state,
  storeSlug,
  snapshot,
  requestedCartRef,
  getCurrentCartRef,
  isCurrent,
  postResult,
}: HandleChatwootDeliveryOptionsActionInput): Promise<void> {
  if (snapshot.estimatedTotals) {
    postUnavailable(requestId, postResult);
    return;
  }

  let deliveryOptions: Record<string, unknown> | null;
  try {
    deliveryOptions = await postChatwootBridgeJson(
      '/api/storefront/chatwoot/context/delivery-options',
      {
        sessionToken,
        conversationId,
        expectedCartVersion: snapshot.cartVersion,
        state,
      },
      storeSlug
    );
  } catch {
    deliveryOptions = null;
  }

  if (!isCurrent()) return;

  const currentCartRef = getCurrentCartRef();
  if (
    !requestedCartRef ||
    !currentCartRef ||
    currentCartRef.cartId !== requestedCartRef.cartId ||
    currentCartRef.version !== snapshot.cartVersion
  ) {
    postUnavailable(requestId, postResult);
    return;
  }

  const parsedOptions =
    chatwootDeliveryOptionsResponseSchema.safeParse(deliveryOptions);
  const requestedSubdivisionCode = resolveSubdivisionCode('NG', state);
  const requestedState = getSubdivisions('NG').find(
    (subdivision) => subdivision.code === requestedSubdivisionCode
  )?.name;
  if (
    !parsedOptions.success ||
    !requestedState ||
    parsedOptions.data.state !== requestedState ||
    parsedOptions.data.cartVersion !== snapshot.cartVersion ||
    parsedOptions.data.currency !== snapshot.currency ||
    parsedOptions.data.subtotalMinor !== snapshot.itemsSubtotalMinor
  ) {
    postUnavailable(requestId, postResult);
    return;
  }

  postResult({ requestId, status: 'ready', ...parsedOptions.data });
}
