import 'server-only';

import {
  buildChatAutoReplyPrompt,
  CHAT_AUTO_REPLY_SYSTEM_PROMPT,
  CHAT_PAY_SMALL_SMALL_GUIDANCE,
  type ChatAutoReplyTurn,
  formatChatAutoReplyProducts,
} from '@/ai/chat-auto-reply-prompt';
import {
  buildShoppingAutoReplyOutcome,
  extractCheckoutNameReply,
  withLookupDeadline,
} from '@/ai/chat-auto-reply-shopping';
import { handleSearchProducts } from '@/ai/chat-catalog-handlers';
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
import {
  CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH,
  type ChatAutoReply,
  type ChatSuggestion,
  chatAutoReplySchema,
  type checkoutNameSchema,
  ekaetteSpecTopics,
} from '@/schemas/chat-auto-reply';

const OVERALL_TIMEOUT_MS = 20_000;

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
    const tenant = await withLookupDeadline(resolveAgenticChatTenant());
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
      return await extractCheckoutNameReply({
        openAIProvider,
        question: input.question,
        overallTimeoutMs: OVERALL_TIMEOUT_MS,
      });
    }
    // A failed or stalled search throws: an outage must never reach the model
    // as "no matching products", so the caller hands over instead.
    const [search, currency] = await withLookupDeadline(
      (async () => {
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
      })()
    );
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
    return await buildShoppingAutoReplyOutcome({
      object,
      search,
      namedProduct,
      merchantSlug: tenant.merchantSlug ?? '',
      currency: currency?.currency,
      history: input.history,
      isStaging,
      stagingCheckoutEnabled,
      canGuidePaySmallSmall,
    });
  } catch {
    console.error('[chat-auto-reply] model failed', {
      merchantId: input.merchantId,
      conversationId: input.conversationId,
    });
    return { ok: false, reason: 'unavailable' };
  }
}
