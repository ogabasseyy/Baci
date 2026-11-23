import {
  isSantaGrantedPriceWithinCeiling,
  parseSantaActions,
  requiresProductSelection,
  stripSantaActions,
} from '@baci/shared/lib';
import { getCachedSantaProductList } from '@/ai/santa-data';
import { withTimeout } from '@/app/api/chat/route-helpers';
import { createPublicClient } from '@/lib/supabase/public';
import {
  CHAT_SANTA_MAX_OFFERS,
  type ChatSantaOffer,
} from '@/schemas/chat-santa-offer';

/** Shown instead of Santa's own words when a price could not be verified. */
export const SANTA_NO_DEAL_REPLY =
  'Ho ho ho! The elves checked the workshop and I cannot approve that price. Tell me another wish or a budget and we will see what we can do, or ask about payment plans.';

const SANTA_GRANTED_FALLBACK_TEXT =
  'Ho ho ho! Your wish is granted. Your offer is below.';

export type SantaVerifiedAnswer = {
  /** What the customer sees: Santa's words with no directives in them. */
  reply: string;
  offers: ChatSantaOffer[];
  /** True when the model tried to grant a price the store would not honour. */
  dropped: boolean;
};

async function verifyOne(input: {
  merchantId: string;
  priceNegotiationEnabled: boolean;
  currency: string;
  productName: string;
  grantedPrice: number;
}): Promise<ChatSantaOffer | null> {
  const catalog = await getCachedSantaProductList(
    input.merchantId,
    input.priceNegotiationEnabled
  );
  const entry = catalog.find((product) => product.name === input.productName);
  if (!entry) return null;

  // The catalog list is cached, so the live row decides the price.
  const supabase = createPublicClient({ clientInfo: 'baci-santa-chat-offer' });
  const { data: product, error } = await supabase
    .from('products')
    .select(
      'id, name, slug, price, has_variants, has_condition_offers, variant_model, available_conditions'
    )
    .eq('merchant_id', input.merchantId)
    .eq('name', entry.name)
    .eq('status', 'active')
    .maybeSingle();
  if (error || !product) return null;
  // A product requiring variant or condition selection cannot be expressed by a chat wish.
  if (requiresProductSelection(product)) return null;
  const slug = product.slug?.trim() ?? '';
  if (!slug) return null;
  const livePrice = Number(product.price);
  if (!(livePrice > 0) || input.grantedPrice > livePrice) return null;
  if (
    !isSantaGrantedPriceWithinCeiling(
      livePrice,
      input.grantedPrice,
      entry.max_discount_percentage
    )
  ) {
    return null;
  }
  return {
    productId: product.id,
    slug,
    name: product.name,
    catalogPrice: livePrice,
    grantedPrice: input.grantedPrice,
    currency: input.currency,
  };
}

const UNPARSED_ACTION_RE = /\bACTION\s*:\s*ADD_TO_CART\b/i;

/**
 * Turns Santa's raw text into what the customer may see. Every ACTION line is
 * checked here against the catalog and the product's maximum discount; if any
 * line fails or any malformed ACTION marker remains, none is honoured and
 * Santa's own words are replaced by a fixed refusal. No directive: plain chat.
 */
export async function verifySantaAnswer(input: {
  text: string;
  merchantId: string;
  priceNegotiationEnabled: boolean;
  currency: string;
  timeoutMs?: number;
}): Promise<SantaVerifiedAnswer> {
  const actions = parseSantaActions(input.text);
  const visible = stripSantaActions(input.text);
  const refused: SantaVerifiedAnswer = {
    reply: SANTA_NO_DEAL_REPLY,
    offers: [],
    dropped: true,
  };
  if (UNPARSED_ACTION_RE.test(visible)) return refused;
  if (actions.length === 0) {
    return { reply: visible, offers: [], dropped: false };
  }
  if (actions.length > CHAT_SANTA_MAX_OFFERS) return refused;
  try {
    const verifyAll = Promise.all(
      actions.map((action) =>
        verifyOne({
          merchantId: input.merchantId,
          priceNegotiationEnabled: input.priceNegotiationEnabled,
          currency: input.currency,
          productName: action.productName,
          grantedPrice: action.price,
        })
      )
    );
    const checked = input.timeoutMs
      ? await withTimeout(
          verifyAll,
          input.timeoutMs,
          'Santa offer verification timed out'
        )
      : await verifyAll;
    const offers = checked.filter(
      (offer): offer is ChatSantaOffer => offer !== null
    );
    if (offers.length !== actions.length) return refused;
    return {
      reply: visible || SANTA_GRANTED_FALLBACK_TEXT,
      offers,
      dropped: false,
    };
  } catch {
    return refused;
  }
}
