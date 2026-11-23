import { clearChatwootCarrierQuote, rememberChatwootCarrierQuote } from '@/hooks/chatwoot-confirmed-carrier-quote';
import { isNigeriaRecoveryPin } from '@/lib/shipping/is-nigeria-recovery-pin';
import { normalizeShippingQuoteResponse } from '@/lib/shipping/quote-response';
import { z } from 'zod';
import { postChatwootBridgeJson } from './chatwoot-bridge-request';

const predictionSchema = z.object({
  placeId: z.string().min(1).max(4000),
  label: z.string().trim().min(1).max(500),
  googleSession: z.string().uuid(),
  expiresAt: z.number().int().safe(),
  proof: z.string().regex(/^[a-f0-9]{64}$/),
});

const addressSchema = z.object({
  formattedAddress: z.string().trim().min(3).max(500),
  streetNumber: z.string(),
  route: z.string(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  country: z.literal('Nigeria'),
  location: z.object({ latitude: z.number().finite(), longitude: z.number().finite() }),
});

const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('search'), requestId: z.string().uuid(), conversationId: z.number().int().positive().safe(), address: z.string().trim().min(3).max(300), sessionToken: z.string().min(1).max(12_000) }),
  z.object({ action: z.literal('decide'), requestId: z.string().uuid(), conversationId: z.number().int().positive().safe(), matchId: z.string().uuid(), answer: z.string().trim().min(1).max(160), sessionToken: z.string().min(1).max(12_000) }),
]);

type Cart = {
  key: string;
  merchantId: string;
  subtotal: number;
  phone?: string;
  items: {
    name: string;
    quantity: number;
    weight: number;
    value: number;
    length?: number;
    width?: number;
    height?: number;
    hsCode?: string;
  }[];
};

type Match = z.infer<typeof predictionSchema> & {
  id: string;
  conversationId: number;
};

const PREFIX = 'baci-ekaette-delivery:';
const MATCH_TTL_MS = 5 * 60_000;

async function readJson(url: string, signal: AbortSignal, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Delivery lookup unavailable');
  return response.json() as Promise<unknown>;
}

export function createEkaetteDeliveryLookup(getCart: () => Cart | null, storeSlug = '') {
  let matches: Match[] = [];
  let pending: AbortController | undefined;

  return {
    close() {
      pending?.abort();
      matches = [];
      clearChatwootCarrierQuote();
    },
    async receive(data: unknown, post: (result: Record<string, unknown>) => void) {
      if (typeof data !== 'string' || !data.startsWith(PREFIX) || data.length > 14_000) return;
      let raw: unknown;
      try {
        raw = JSON.parse(data.slice(PREFIX.length));
      } catch {
        return;
      }
      const parsed = commandSchema.safeParse(raw);
      if (!parsed.success) return;
      const command = parsed.data;
      clearChatwootCarrierQuote();
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const timer = setTimeout(() => controller.abort(), 28_000);
      let addressAccepted = false;
      const respond = (result: Record<string, unknown>) => {
        if (pending === controller) post({ requestId: command.requestId, ...result });
      };
      try {
        if (command.action === 'search') {
          matches = [];
          const payload = await postChatwootBridgeJson(
            '/api/storefront/chatwoot/delivery-confirmation',
            { action: 'search', address: command.address, conversationId: command.conversationId, sessionToken: command.sessionToken },
            storeSlug,
            controller.signal,
          );
          if (payload?.decision === 'side_question' || payload?.decision === 'unclear') {
            respond({ status: payload.decision === 'side_question' ? 'side_question' : 'address_unavailable' });
            return;
          }
          const prediction = z.object({ match: predictionSchema.nullable() }).parse(payload).match;
          if (pending !== controller || controller.signal.aborted) return;
          matches = prediction ? [{ ...prediction, id: crypto.randomUUID(), conversationId: command.conversationId }] : [];
          respond({ status: 'matches', matches: matches.map(({ id, label }) => ({ id, label })) });
          return;
        }

        const match = matches.find(item => item.id === command.matchId && item.conversationId === command.conversationId && item.expiresAt > Date.now());
        if (!match) {
          respond({ status: 'address_unavailable' });
          return;
        }
        const { answer, conversationId, sessionToken } = command;
        const decision = await postChatwootBridgeJson(
          '/api/storefront/chatwoot/delivery-confirmation',
          { action: 'decide', answer, conversationId, sessionToken, match },
          storeSlug,
          controller.signal,
        );
        if (pending !== controller || controller.signal.aborted) return;
        if (decision?.decision === 'different_address') {
          matches = [];
          respond({ status: 'different_address' });
          return;
        }
        if (decision?.decision !== 'confirmed') {
          respond({ status: 'confirmation_unclear' });
          return;
        }
        addressAccepted = true;
        const params = new URLSearchParams({ placeId: match.placeId, sessionToken: match.googleSession });
        const payload = await readJson(`/api/places/details?${params}`, controller.signal);
        const address = z.object({ details: addressSchema }).parse(payload).details;
        const { latitude, longitude } = address.location;
        const line1 = [address.streetNumber, address.route].filter(Boolean).join(' ');
        if (!address.route || !isNigeriaRecoveryPin(latitude, longitude)) {
          respond({ status: 'address_unavailable' });
          return;
        }
        const confirmed = { line1, city: address.city, state: address.state, label: address.formattedAddress };
        const cart = getCart();
        if (!cart) {
          respond({ status: 'cart_unavailable', address: confirmed });
          return;
        }
        const response = await readJson('/api/shipping/quotes', controller.signal, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-baci-client': 'web-storefront' },
          body: JSON.stringify({
            merchantId: cart.merchantId,
            carrier: 'GIGL',
            deliveryPreference: 'door',
            receiver: {
              name: 'Storefront shopper',
              phone:
                cart.phone && cart.phone.trim().length >= 10
                  ? cart.phone.trim()
                  : '08000000000',
              address: line1,
              city: address.city,
              state: address.state,
              country: 'Nigeria',
              countryCode: 'NG',
              latitude,
              longitude,
            },
            items: cart.items,
            cart_subtotal: cart.subtotal,
          }),
        });
        if (getCart()?.key !== cart.key) {
          respond({ status: 'cart_unavailable', address: confirmed });
          return;
        }
        const quote = normalizeShippingQuoteResponse(response).quotes
          .filter(item => item.provider === 'GIGL' && !item.isStationPickup &&
            item.currency === 'NGN' && Number.isFinite(item.price) && item.price >= 0)
          .sort((left, right) => left.price - right.price)[0];
        if (pending !== controller || controller.signal.aborted) return;
        const expiry = z.object({ expiresAt: z.string() }).safeParse(response);
        const expiresAt = expiry.success ? Date.parse(expiry.data.expiresAt) : Number.NaN;
        if (!quote || !z.string().uuid().safeParse(quote.id).success || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          respond({ status: 'quote_unavailable', address: confirmed });
          return;
        }
        const id = crypto.randomUUID();
        rememberChatwootCarrierQuote({
          id,
          cartKey: cart.key,
          conversationId: command.conversationId,
          merchantId: cart.merchantId,
          expiresAt: Math.min(expiresAt, Date.now() + MATCH_TTL_MS),
          quote,
          address: { address: line1, city: address.city, state: address.state,
            country: 'Nigeria', countryCode: 'NG', latitude, longitude },
        });
        respond({ status: 'quoted', address: confirmed, price: quote.price, currency: 'NGN', quoteId: id });
      } catch {
        respond({ status: command.action === 'search' ? 'search_unavailable' :
          addressAccepted ? 'quote_unavailable' : 'confirmation_unclear' });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
