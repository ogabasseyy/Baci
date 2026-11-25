import 'server-only';

import { requiresProductSelection } from '@baci/shared/lib';
import { withCartLimit, withNarrowDownNudge } from '@/ai/chat-auto-reply-nudge';
import type { ChatAutoReplyTurn } from '@/ai/chat-auto-reply-prompt';
import { handleSearchProducts } from '@/ai/chat-catalog-handlers';
import type { ChatProductResult } from '@/ai/chat-product-result';
import { findNamedEkaetteProduct } from '@/ai/ekaette-product-research';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import { sanitizePromptInput } from '@/ai/provider';
import {
  type getOgabasseyPreferredProviders,
  OGABASSEY_MODEL_PROVIDER_OPTIONS,
} from '@/app/api/chat/ogabassey-model-providers';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import {
  CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH,
  CHAT_AUTO_REPLY_MIN_CONFIDENCE,
  type ChatAutoReply,
  type ChatSuggestion,
  checkoutNameDecisionSchema,
} from '@/schemas/chat-auto-reply';
import type { ChatAutoReplyProduct } from './chat-auto-reply';

const CART_ACTION_MIN_CONFIDENCE = 0.85;
export const LOOKUP_DEADLINE_MS = 10_000;

type OpenAIProvider = ReturnType<typeof getOgabasseyPreferredProviders>[number];

export function withLookupDeadline<T>(
  promise: Promise<T>,
  ms = LOOKUP_DEADLINE_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Lookup timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function projectProductCard(
  product: ChatProductResult,
  storeSlug: string,
  currency: string
): ChatAutoReplyProduct | null {
  const { slug, image_url, brand } = product;
  if (!slug || !/^[a-z0-9_]+(?:-[a-z0-9_]+)*$/i.test(slug)) return null;
  const price = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(product.price);
  const options = requiresProductSelection(product);
  return {
    name: product.name,
    slug,
    currency,
    ...(image_url && URL.parse(image_url)?.protocol === 'https:'
      ? { imageUrl: image_url }
      : {}),
    ...(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(storeSlug)
      ? {
          productPath: getStorefrontProductHref(
            {
              id: product.id,
              name: product.name,
              category: product.category,
              slug,
            },
            `/${storeSlug}`
          ),
        }
      : {}),
    ...(brand ? { brand } : {}),
    ...(product.has_condition_offers ? { storefrontOnly: true } : {}),
    ...(Number.isFinite(product.price)
      ? { priceLabel: options ? `From ${price}` : price }
      : {}),
  };
}

export async function extractCheckoutNameReply(input: {
  openAIProvider: OpenAIProvider;
  question: string;
  overallTimeoutMs: number;
}) {
  const { object } = await generateObjectWithChain({
    chain: [input.openAIProvider],
    providerOptions: { openai: OGABASSEY_MODEL_PROVIDER_OPTIONS.openai },
    schema: checkoutNameDecisionSchema,
    system:
      'The assistant just asked the shopper for the first and last name for their new checkout. Extract only the name the shopper wants on this order from their response, regardless of how they say it. Return JSON {"checkoutName":{"firstName":"...", "lastName":"..."}} if both parts are explicitly provided, or {"checkoutName":null} if either part is missing, unclear, or the customer did not supply a checkout name. Never guess.',
    messages: [
      {
        role: 'user',
        content: sanitizePromptInput(
          input.question,
          CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH
        ).value,
      },
    ],
    maxOutputTokens: 120,
    overallTimeoutMs: input.overallTimeoutMs,
  });
  return {
    ok: true as const,
    ...(object.checkoutName
      ? { checkoutName: object.checkoutName }
      : { suggestions: ['review_checkout'] as ChatSuggestion[] }),
    reply: {
      reply: object.checkoutName
        ? 'Thanks. I’ve added your name to the checkout here.'
        : 'Please, what’s your name and surname?',
      confidence: 1,
      needsHuman: false,
    },
  };
}

export async function buildShoppingAutoReplyOutcome(input: {
  object: ChatAutoReply;
  search: { products: readonly ChatProductResult[] };
  namedProduct?: ChatProductResult;
  merchantSlug: string;
  currency?: string;
  history: readonly ChatAutoReplyTurn[];
  shoppingEnabled: boolean;
  checkoutEnabled: boolean;
  canGuidePaySmallSmall: boolean;
}): Promise<{
  ok: true;
  reply: ChatAutoReply;
  cards?: ChatAutoReplyProduct[];
  cartAction?: {
    slug: string;
    options: { axis: string; value: string }[];
  };
  suggestions?: ChatSuggestion[];
}> {
  const {
    object,
    search,
    namedProduct,
    merchantSlug,
    currency,
    history,
    shoppingEnabled,
    checkoutEnabled,
    canGuidePaySmallSmall,
  } = input;

  if (checkoutEnabled && object.checkoutHelp && !object.needsHuman) {
    return {
      ok: true,
      reply: { ...object, reply: 'I can help you check out here.' },
      suggestions: ['review_checkout'],
    };
  }
  if (checkoutEnabled && object.orderHelp && !object.needsHuman) {
    return {
      ok: true,
      reply: {
        ...object,
        reply: 'You can check your order in the secure order panel below.',
      },
      suggestions: ['orders'],
    };
  }
  if (
    checkoutEnabled &&
    object.intent === 'add_to_cart' &&
    !object.needsHuman &&
    object.confidence >= CHAT_AUTO_REPLY_MIN_CONFIDENCE
  ) {
    const query = object.cartProductQuery;
    const product = query
      ? (findNamedEkaetteProduct(query, search.products) ??
        findNamedEkaetteProduct(
          query,
          (await withLookupDeadline(handleSearchProducts({ query }))).products
        ))
      : undefined;
    const card =
      product && currency
        ? projectProductCard(product, merchantSlug, currency)
        : null;
    const cartAction =
      object.cartAdd &&
      object.confidence >= CART_ACTION_MIN_CONFIDENCE &&
      card &&
      !card.storefrontOnly
        ? { slug: card.slug, options: object.cartOptions ?? [] }
        : undefined;
    return {
      ok: true,
      reply: {
        ...object,
        reply: cartAction
          ? 'If you need another choice, you can pick it on the card below.'
          : card
            ? card.storefrontOnly
              ? 'Open the product card to choose your options.'
              : 'Choose your options on the card below. You can tap Add to cart or ask me to add it.\n\nReview checkout will show which payment options are available.'
            : 'Which model would you like me to find for you?',
      },
      ...(card ? { cards: [card] } : {}),
      ...(cartAction ? { cartAction } : {}),
    };
  }

  const canShowCards =
    shoppingEnabled &&
    !object.needsHuman &&
    object.intent &&
    object.intent !== 'other';
  const recommended =
    object.intent === 'discover' || object.intent === 'recommend';
  const catalog =
    shoppingEnabled &&
    recommended &&
    object.catalogCategory &&
    !search.products.some(
      (product) => product.category?.toLowerCase() === object.catalogCategory
    )
      ? await withLookupDeadline(
          handleSearchProducts({ query: '', category: object.catalogCategory })
        )
      : search;
  const listedProducts = new Map(
    catalog.products.slice(0, 5).map((item) => [item.slug, item])
  );
  const selected =
    recommended && object.productSlugs?.length
      ? [...new Set(object.productSlugs)].flatMap((slug) => {
          const item = listedProducts.get(slug);
          return item ? [item] : [];
        })
      : [];
  const picks = selected.length
    ? selected
    : namedProduct
      ? [namedProduct]
      : catalog !== search
        ? catalog.products.slice(0, 3)
        : [];
  const cards =
    canShowCards && currency
      ? picks.flatMap((item) => {
          const card = projectProductCard(item, merchantSlug, currency);
          return card ? [card] : [];
        })
      : [];
  const draft =
    cards.some((card) => !card.storefrontOnly) &&
    object.intent === 'add_to_cart'
      ? {
          ...object,
          reply:
            'You can tap Options on the product card to add it to your cart.',
        }
      : withCartLimit(object);
  const shopping = recommended || cards.length > 0;
  const recentCard = history.slice(-4).findLast((turn) => turn.productCard);
  const suggestions =
    shoppingEnabled && !object.needsHuman
      ? [...new Set(object.suggestions)].filter((suggestion) => {
          switch (suggestion) {
            case 'browse_phones':
              return recommended && cards.length === 0;
            case 'compare_products':
              return cards.length > 1;
            case 'pay_small_small':
              return canGuidePaySmallSmall && shopping;
            case 'add_to_cart':
              return (
                checkoutEnabled &&
                cards.length === 0 &&
                !!recentCard &&
                new Set(recentCard.content.split('\n').filter(Boolean)).size ===
                  1
              );
            case 'orders':
              return false;
            case 'repair_quote':
              return checkoutEnabled;
            default:
              return false;
          }
        })
      : [];
  return {
    ok: true,
    ...(suggestions.length ? { suggestions: suggestions.slice(0, 2) } : {}),
    reply: withNarrowDownNudge(draft, catalog.products.length),
    ...(cards.length ? { cards } : {}),
  };
}
