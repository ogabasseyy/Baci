import type { CartItem } from '@/hooks/cart';
import type { ChatwootCommerceMessage } from '@/schemas/chatwoot-commerce-message';
import { resolveChatwootCheckoutDelivery } from './chatwoot-checkout-delivery';
import type { ChatwootCheckoutMerchant } from './chatwoot-checkout-merchant';
import { resolveChatwootCarrierQuote } from './chatwoot-confirmed-carrier-quote';

type PlaceData = Extract<
  ChatwootCommerceMessage,
  { event: 'baci-checkout-place-request' }
>['data'];

export async function resolveChatwootPlaceDelivery(input: {
  request: PlaceData;
  authorizedCartId: string;
  merchant: ChatwootCheckoutMerchant;
  display: CartItem[];
  itemsSubtotalMinor: number;
}) {
  const { request, authorizedCartId, merchant, display, itemsSubtotalMinor } =
    input;
  const carrier = request.carrierQuoteId
    ? resolveChatwootCarrierQuote({
        id: request.carrierQuoteId,
        cartKey: `${authorizedCartId}:${request.cartVersion}`,
        merchantId: merchant.id,
        conversationId: request.conversationId,
      })
    : null;
  if (request.carrierQuoteId && !carrier) {
    return { ok: false as const, code: 'delivery_unavailable' as const };
  }
  if (carrier) {
    return {
      ok: true as const,
      method: 'door' as const,
      quote: carrier.quote,
      carrier: 'GIGL' as const,
      merchantRateId: null,
      address: { ...carrier.address, phone: request.customer.phone },
    };
  }
  return await resolveChatwootCheckoutDelivery({
    merchantId: merchant.id,
    customer: request.customer,
    address: request.address,
    choice: request.delivery,
    quoteItems: display.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      negotiatedPrice: item.negotiatedPrice,
    })),
    cartSubtotal: itemsSubtotalMinor / 100,
  });
}
