import 'server-only';

import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { createClient } from '@/lib/supabase/server';
import { getGiftCardPreviewCatalog } from './preview-catalog';
import { getGiftCardQuote } from './quote';

const signatureDomain = 'baci:gift-card-wallet:v1\n';
const inputSchema = z.object({
  cardId: z.string().regex(/^\d{1,16}$/),
});
const proofSchema = z.object({
  payload: z.string().min(1).max(1024),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function issueAuthenticatedGiftCardQuote(
  input: unknown,
  orderId?: string
) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Sign in to get a wallet quote');

  const { cardId } = inputSchema.parse(input);
  const merchant = await getRequestScopedMerchant('ogabassey');
  const card = getGiftCardPreviewCatalog().find((item) => item.id === cardId);
  const signingKey = process.env.GIFT_CARD_WALLET_QUOTE_HMAC;
  const rateKey = process.env.JUICYWAY_EXCHANGE_RATE_READ_KEY?.trim();
  const markupRaw = process.env.OGABASSEY_GIFT_CARD_PREVIEW_MARKUP_BPS;
  const markup = Number(markupRaw);
  if (
    merchant?.slug !== 'ogabassey' ||
    !card ||
    !signingKey ||
    signingKey.length < 32 ||
    !rateKey ||
    !markupRaw?.trim() ||
    !Number.isSafeInteger(markup) ||
    markup < 0
  ) {
    throw new Error('Gift card pricing is temporarily unavailable');
  }

  const totalKobo = await getGiftCardQuote(card.usdCents, markup, rateKey);
  if (totalKobo > 9_999_999_999)
    throw new Error('Gift card price is out of range');

  const quote = {
    id: orderId === undefined ? randomUUID() : z.uuid().parse(orderId),
    merchantId: merchant.id,
    userId: data.user.id,
    cardId,
    totalKobo,
    expiresAt: Date.now() + 60_000,
  };
  const payload = JSON.stringify(quote);
  const signature = createHmac('sha256', signingKey)
    .update(signatureDomain + payload)
    .digest('hex');

  return {
    totalKobo,
    expiresAt: quote.expiresAt,
    proof: { payload, signature },
  };
}

export async function confirmAuthenticatedGiftCardQuote(input: unknown) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Sign in before confirming');

  const proof = proofSchema.parse(input);
  // The migration is append-only. Regenerate Supabase types after schema rollout.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    name: 'confirm_gift_card_wallet_quote',
    args: { p_payload: string; p_signature: string }
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  const result = await rpc('confirm_gift_card_wallet_quote', {
    p_payload: proof.payload,
    p_signature: proof.signature,
  });
  if (result.error) throw new Error('Gift card payment could not be confirmed');
  return z
    .array(z.object({ order_id: z.uuid(), order_status: z.string() }))
    .length(1)
    .parse(result.data)[0];
}
