import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createQuizRpcServerProof } from '@/lib/quiz-proof';
import type { BankCardOfferQuote } from './bank-card-offer-payment';

export function createBankCardOfferCheckout({
  client,
  orderArgs,
  quote,
  userId,
}: {
  client: Pick<SupabaseClient, 'rpc'>;
  orderArgs: Record<string, unknown>;
  quote: BankCardOfferQuote;
  userId: string;
}) {
  const order = Object.fromEntries(
    Object.entries(orderArgs)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key.replace(/^p_/, ''), value])
  );
  // Strip optional undefined item properties before signing the wire payload.
  const payload = JSON.parse(JSON.stringify({ order, quote }));
  return client.rpc('create_storefront_bank_card_offer_order', {
    p_order: payload.order,
    p_quote: payload.quote,
    p_route_proof: createQuizRpcServerProof({
      action: 'storefront_bank_card_offer_order_create',
      payload,
      subjectId: quote.merchantId,
      userId,
    }),
  });
}
