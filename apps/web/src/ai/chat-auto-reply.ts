import 'server-only';

import { withCartLimit, withNarrowDownNudge } from '@/ai/chat-auto-reply-nudge';
import {
  buildChatAutoReplyPrompt,
  CHAT_AUTO_REPLY_SYSTEM_PROMPT,
  CHAT_PAY_SMALL_SMALL_GUIDANCE,
  type ChatAutoReplyTurn,
  formatChatAutoReplyProducts,
} from '@/ai/chat-auto-reply-prompt';
import { handleSearchProducts } from '@/ai/chat-catalog-handlers';
import type { ChatProductResult } from '@/ai/chat-product-result';
import {
  findNamedEkaetteProduct,
  researchEkaetteProduct,
} from '@/ai/ekaette-product-research';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import {
  AI_RATE_LIMITS,
  checkRateLimit,
  sanitizePromptInput,
} from '@/ai/provider';
import {
  getOgabasseyPreferredProviders,
  OGABASSEY_MODEL_PROVIDER_OPTIONS,
} from '@/app/api/chat/ogabassey-model-providers';
import { isOxygenStorefrontStagingEnabled } from '@/config/oxygen-storefront-staging';
import { resolveAgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { loadChatwootMerchantCurrency } from '@/lib/chatwoot/merchant-currency';
import type { ChatwootProductCard } from '@/lib/chatwoot/product-card-projection';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import {
  CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH,
  CHAT_AUTO_REPLY_MIN_CONFIDENCE,
  type ChatAutoReply,
  type ChatSuggestion,
  chatAutoReplySchema,
  checkoutNameDecisionSchema,
  type checkoutNameSchema,
  ekaetteSpecTopics,
} from '@/schemas/chat-auto-reply';

const OVERALL_TIMEOUT_MS = 20_000;
const CART_ACTION_MIN_CONFIDENCE = 0.85;

export type ChatAutoReplyProduct = {
  name: string;
  slug: string;
  imageUrl?: string;
  productPath?: string;
  brand?: string;
  priceLabel?: string;
  currency?: string;
  initialProduct?: ChatwootProductCard;
  storefrontOnly?: boolean;
};

const WIDGET_CART_GUIDANCE = `When the shopper clearly wants to buy an item or add it to their cart, use intent "add_to_cart", even if they also mention how they want to pay. Include "cartProductQuery" with the full product model (for example, "iPhone 13") using the shopper's current message and the product they were just discussing. Resolve short references like "the 13" from conversation context. If several products could match, ask which one and omit cartProductQuery. The store uses this field to find the product and show the cart action. Set "cartAdd" to true for a clear shopping commitment such as choosing to take an item, asking to put it in the basket, or accepting an offer to add it. Interpret meaning in context, including typos, shorthand and Nigerian English. Treat a missing variant as a separate question from deciding whether the shopper wants the item added: set cartAdd true for a clear commitment even when some catalog options are missing, and include only the choices actually made. Payment questions, browsing, comparing, quoted examples, and requests with an unaccepted condition are not cart instructions. Include "cartOptions" as an array of {axis,value} for options the shopper actually chose (storage, color, condition, or another catalog option). Use standard spelling (blue, used, 128GB), never assume a missing choice. If they explicitly leave it to you or options are unclear, leave it for them to choose. Do not claim that you added anything. For general shopping requests, you may set "catalogCategory" to smartphones, laptops or tablets. Set "orderHelp": true and needsHuman: false when a shopper simply wants to find or check their own existing order. A secure order view handles the lookup. Keep payment problems and disputes with a person. Set "checkoutHelp": true and needsHuman: false when the shopper wants to check out or continue to their Pay Small Small application for an item they have already added. A general question about payment or a request to add an item is not a checkout start. Suggest "add_to_cart" only when a recent single product card is the clear subject and an offer to help would be useful. Never promise a payment plan.`;

const WIDGET_SHOPPING_GUIDANCE = `For a purely technical question about a catalog product, set researchTopic to one of: ${ekaetteSpecTopics.join(', ')}. If the shopper also asks about price, stock, payment, or anything about a store transaction, omit researchTopic and answer the store question. For product recommendations and comparisons, include a productSlugs array (up to three) in your JSON. Use only the exact slugs listed in the catalog for the items you actually recommend. If more results were requested than the catalog contains, say how many matched. Suggest up to two useful follow-up actions in the optional suggestions array. Use browse_phones for someone interested in phones, compare_products after presenting multiple products, pay_small_small when it helps with a purchase, and repair_quote only for a repair question. Omit suggestions when there is no useful next action. Order actions are added by the storefront. Do not request order identifiers or personal information in chat.`;

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
  const options =
    product.has_variants ||
    product.variant_model === 'sku_matrix' ||
    product.has_condition_offers;
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

export type ChatAutoReplyResult =
  | {
      ok: true;
      reply: ChatAutoReply;
      cards?: ChatAutoReplyProduct[];
      suggestions?: ChatSuggestion[];
      checkoutName?: ReturnType<typeof checkoutNameSchema.parse>;
      cartAction?: {
        slug: string;
        options: NonNullable<ChatAutoReply['cartOptions']>;
      };
    }
  | { ok: false; reason: 'rate_limited' | 'unavailable' };

/**
 * Drafts the assistant's answer to one customer message. Rate limited per
 * conversation and per store; the answer is validated against the schema, so
 * off-shape model output is a failure (the caller then hands over to a
 * person), never a guess shown to the customer.
 */
export async function generateChatAutoReply(input: {
  merchantId: string;
  conversationId: number;
  question: string;
  history: readonly ChatAutoReplyTurn[];
}): Promise<ChatAutoReplyResult> {
  // The store-wide limiter only runs once the conversation's own limit
  // passes: it consumes quota on every allowed check, so a chatty
  // conversation must not drain the quota other customers share.
  const perConversation = checkRateLimit(
    `chat-auto-reply:conversation:${input.merchantId}:${input.conversationId}`,
    AI_RATE_LIMITS.chatAutoReplyConversation
  );
  const perMerchant = perConversation.allowed
    ? checkRateLimit(
        `chat-auto-reply:merchant:${input.merchantId}`,
        AI_RATE_LIMITS.chatAutoReplyMerchant
      )
    : null;
  if (!perConversation.allowed || !perMerchant?.allowed) {
    return { ok: false, reason: 'rate_limited' };
  }

  try {
    // The catalog search is bound to one configured store. For any other
    // store (or none) the assistant has no catalog to ground on, and "no
    // matching products" would be a false claim: hand over instead.
    const tenant = await resolveAgenticChatTenant();
    if (tenant?.merchantId !== input.merchantId) {
      return { ok: false, reason: 'unavailable' };
    }
    const isStaging = isOxygenStorefrontStagingEnabled();
    const stagingCheckoutEnabled =
      isStaging && process.env.EKAETTE_CHATWOOT_CHECKOUT_ENABLED === 'true';
    const awaitingCheckoutName =
      stagingCheckoutEnabled &&
      input.history.findLast((turn) => turn.role === 'assistant')
        ?.checkoutNameRequested === true;
    const openAIProvider = getOgabasseyPreferredProviders().find((provider) =>
      provider.name.startsWith('openai:')
    );
    if (!openAIProvider) {
      return { ok: false, reason: 'unavailable' };
    }
    if (awaitingCheckoutName) {
      const { object } = await generateObjectWithChain({
        chain: [openAIProvider],
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
        overallTimeoutMs: OVERALL_TIMEOUT_MS,
      });
      return {
        ok: true,
        ...(object.checkoutName
          ? { checkoutName: object.checkoutName }
          : { suggestions: ['review_checkout'] }),
        reply: {
          reply: object.checkoutName
            ? 'Thanks. I’ve added your name to the checkout here.'
            : 'Please, what’s your name and surname?',
          confidence: 1,
          needsHuman: false,
        },
      };
    }
    // A failed or stalled search throws: an outage must never reach the model
    // as "no matching products", so the caller hands over instead.
    const LOOKUP_DEADLINE_MS = 10_000;
    const lookupWithDeadline = async () => {
      let [found, merchantCurrency] = await Promise.all([
        handleSearchProducts({ query: input.question }),
        loadChatwootMerchantCurrency(input.merchantId),
      ]);
      if (found.products.length === 0) {
        const previousUserTurn = input.history.findLast(
          (turn) =>
            turn.role === 'user' &&
            turn.content.trim().length > 0 &&
            turn.content.trim() !== input.question.trim()
        );
        if (previousUserTurn) {
          found = await handleSearchProducts({
            query: previousUserTurn.content,
          });
        }
      }
      return [found, merchantCurrency] as const;
    };
    let lookupTimer: ReturnType<typeof setTimeout> | undefined;
    const [search, currency] = await Promise.race([
      lookupWithDeadline(),
      new Promise<never>((_, reject) => {
        lookupTimer = setTimeout(
          () => reject(new Error('Catalog lookup timed out')),
          LOOKUP_DEADLINE_MS
        );
      }),
    ]).finally(() => {
      if (lookupTimer) clearTimeout(lookupTimer);
    });
    // Prices without a currency are ambiguous: never show them.
    if (search.products.length > 0 && !currency?.currency) {
      return { ok: false, reason: 'unavailable' };
    }
    const products = formatChatAutoReplyProducts(
      search.products,
      currency?.currency ?? '',
      isStaging
    ).trim();
    const question = sanitizePromptInput(
      input.question,
      CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH
    ).value;
    const namedProduct = isStaging
      ? findNamedEkaetteProduct(question, search.products)
      : undefined;
    const canGuidePaySmallSmall =
      currency?.currency === 'NGN' && stagingCheckoutEnabled;
    const { object } = await generateObjectWithChain({
      chain: [openAIProvider],
      providerOptions: { openai: OGABASSEY_MODEL_PROVIDER_OPTIONS.openai },
      schema: chatAutoReplySchema,
      system: [
        CHAT_AUTO_REPLY_SYSTEM_PROMPT,
        ...(isStaging ? [WIDGET_SHOPPING_GUIDANCE] : []),
        ...(stagingCheckoutEnabled ? [WIDGET_CART_GUIDANCE] : []),
        ...(canGuidePaySmallSmall ? [CHAT_PAY_SMALL_SMALL_GUIDANCE] : []),
      ].join('\n\n'),
      messages: [
        ...input.history.map((turn) => ({
          role: turn.role,
          content: sanitizePromptInput(
            turn.content,
            CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH
          ).value,
        })),
        {
          role: 'user' as const,
          content: buildChatAutoReplyPrompt({
            question,
            products,
          }),
        },
      ],
      maxOutputTokens: 600,
      overallTimeoutMs: OVERALL_TIMEOUT_MS,
      validate: (parsed) =>
        !parsed.needsHuman && parsed.reply.length === 0
          ? 'empty reply without handover'
          : null,
    });
    if (
      isStaging &&
      namedProduct &&
      object.intent === 'details' &&
      !object.needsHuman &&
      object.researchTopic
    ) {
      const research = await researchEkaetteProduct({
        model: openAIProvider.name.slice('openai:'.length),
        topic: object.researchTopic,
        product: namedProduct,
      });
      if (research) return { ok: true, reply: research };
    }
    if (stagingCheckoutEnabled && object.checkoutHelp && !object.needsHuman) {
      return {
        ok: true,
        reply: {
          ...object,
          reply: 'I can help you check out here.',
        },
        suggestions: ['review_checkout'],
      };
    }
    if (stagingCheckoutEnabled && object.orderHelp && !object.needsHuman) {
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
      stagingCheckoutEnabled &&
      object.intent === 'add_to_cart' &&
      !object.needsHuman &&
      object.confidence >= CHAT_AUTO_REPLY_MIN_CONFIDENCE
    ) {
      const query = object.cartProductQuery;
      const product = query
        ? (findNamedEkaetteProduct(query, search.products) ??
          findNamedEkaetteProduct(
            query,
            (await handleSearchProducts({ query })).products
          ))
        : undefined;
      const card =
        product && currency?.currency
          ? projectProductCard(
              product,
              tenant.merchantSlug ?? '',
              currency.currency
            )
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
      isStaging &&
      !object.needsHuman &&
      object.intent &&
      object.intent !== 'other';
    const recommended =
      object.intent === 'discover' || object.intent === 'recommend';
    const catalog =
      isStaging &&
      recommended &&
      object.catalogCategory &&
      !search.products.some(
        (product) => product.category?.toLowerCase() === object.catalogCategory
      )
        ? await handleSearchProducts({
            query: '',
            category: object.catalogCategory,
          })
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
      canShowCards && currency?.currency
        ? picks.flatMap((item) => {
            const card = projectProductCard(
              item,
              tenant.merchantSlug ?? '',
              currency.currency
            );
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
    const recentCard = input.history
      .slice(-4)
      .findLast((turn) => turn.productCard);
    const suggestions =
      isStaging && !object.needsHuman
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
                  stagingCheckoutEnabled &&
                  cards.length === 0 &&
                  !!recentCard &&
                  new Set(recentCard.content.split('\n').filter(Boolean))
                    .size === 1
                );
              case 'orders':
                return false;
              case 'repair_quote':
                return stagingCheckoutEnabled;
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
  } catch {
    console.error('[chat-auto-reply] model failed', {
      merchantId: input.merchantId,
      conversationId: input.conversationId,
    });
    return { ok: false, reason: 'unavailable' };
  }
}
