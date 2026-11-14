import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { storedStorefrontShippingQuotesSchema } from '@/schemas/storefront-shipping-quote';
import { parseQuoteReadCapability } from './quote-session-capability';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';
/** The normal caller client carries the proof; no privileged client is constructed. */
export async function persistStorefrontShippingQuote(
  client: SupabaseClient,
  quote: Record<string, unknown>
) {
  const merchantId = quote.merchant_id;
  if (
    typeof merchantId !== 'string' ||
    !merchantId ||
    typeof quote.id !== 'string'
  )
    throw Error('QUOTE_MERCHANT_REQUIRED');
  const proof = createShippingQuoteRouteProof({
    action: 'persist_storefront_shipping_quote',
    merchantId,
    subjectId: quote.id,
    payload: { quote },
  });
  return await client.rpc('persist_storefront_shipping_quote', {
    p_quote: quote,
    p_route_proof: proof,
  });
}
export async function assertStorefrontQuoteStorage(
  client: SupabaseClient,
  merchantId: string | undefined
) {
  try {
    if (!merchantId) throw Error('QUOTE_MERCHANT_REQUIRED');
    const requestId = randomUUID();
    const proof = createShippingQuoteRouteProof({
      action: 'storefront_shipping_quote_storage_ready',
      merchantId,
      subjectId: requestId,
      payload: { merchant_id: merchantId },
    });
    const r = await client.rpc('storefront_shipping_quote_storage_ready', {
      p_merchant_id: merchantId,
      p_request_id: requestId,
      p_route_proof: proof,
    });
    if (r.error || r.data !== true) throw Error('QUOTE_STORAGE_UNAVAILABLE');
  } catch {
    throw new QuoteStorageUnavailable();
  }
}
export class QuoteStorageUnavailable extends Error {
  constructor() {
    super('QUOTE_STORAGE_UNAVAILABLE');
  }
}
export async function readStorefrontShippingQuotes(
  client: SupabaseClient,
  merchantId: string,
  sessionId: string,
  token: string | undefined
) {
  const proof = parseQuoteReadCapability(token);
  if (!proof || proof.merchant_id !== merchantId)
    return { error: { code: 'QUOTE_SESSION_REQUIRED' }, data: null };
  const r = await client.rpc('read_storefront_shipping_quotes', {
    p_merchant_id: merchantId,
    p_session_id: sessionId,
    p_request_id: proof.subject_id,
    p_route_proof: proof,
  });
  return {
    error: r.error,
    data: r.error ? null : storedStorefrontShippingQuotesSchema.parse(r.data),
  };
}

/** A caller-selected session is reusable only with its original read capability. */
export async function resolveStorefrontQuoteSession(
  client: SupabaseClient,
  merchantId: string | undefined,
  requested: string | undefined,
  token: string | undefined
) {
  if (merchantId && requested && requested.length <= 200 && token) {
    try {
      const r = await readStorefrontShippingQuotes(
        client,
        merchantId,
        requested,
        token
      );
      if (!r.error) return requested;
    } catch {
      /* Unverified/expired continuation starts a new quote session. */
    }
  }
  return randomUUID();
}
