import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateTextWithChain } from '@/ai/generate-text-with-chain';
import type { TextProvider } from '@/ai/text-provider-chain';
import type { AiChatProvider } from '@/env';
import { buildStorefrontDisplayData } from '@/lib/agentic/storefront-display-data';
import { isBusinessFactRequest } from './fast-catalog-language';
import { resolveOgabasseyCommerceContext } from './ogabassey-commerce-context';
import { createStaticChatFallbackResponse } from './route-helpers';

const PER_PROVIDER_TIMEOUT_MS = 6_000;
const MAX_CHAIN_TIMEOUT_MS = 12_000;
const NEGOTIATION =
  /\b(?:negotiat\w*|discount\w*|haggl\w*|(?:last|final)\s+price|(?:reduce|lower)\s+(?:the\s+|your\s+)?(?:price|cost)|bargain|deal)\b/i;
const CATALOG_FACT_REQUEST =
  /\b(?:recommend\w*|suggest\w*|products?|devices?|phones?|smartphones?|iphone\w*|ipad\w*|laptops?|macbooks?|tablets?|cameras?|watches|smartwatches?|speakers?|consoles?|televisions?|monitors?|galaxy\w*|apple|samsung|sony|nokia|oppo|vivo|huawei|tecno|infinix|xiaomi|redmi|pixel|itel|oraimo|anker|accessor(?:y|ies)|chargers?|cables?|adapters?|cases?|screen[\s-]*protectors?|earbuds?|headphones?|airpods|price|prices|cost|budget|cheap\w*|available|availability|stock|compatib\w*|storage|colour|color|black|white|blue|red|green)\b/i;
const GENERAL_AVAILABILITY_REQUEST =
  /\b(?:do\s+you\s+(?:have|stock|carry|sell)|have\s+you\s+got)\b/i;
const PRODUCT_REFERENCE = /\b(?:it|this|that|these|those|one|ones)\b/i;
const PRODUCT_AMOUNT = /[₦$€£\d]|\b(?:enough|afford\w*|cheaper|less|more)\b/i;
const SHOPPING_ADVICE_REQUEST =
  /\b(?:gifts?|shopping|(?:a|the|birthday|christmas)\s+present)\b/i;
const UNGROUNDED_REPLY =
  /[\p{N}₦$€£]|\b(?:naira|iphone|ipad|macbook|airpods|apple|samsung|galaxy|sony|nokia|oppo|vivo|huawei|tecno|infinix|xiaomi|redmi|pixel|itel|oraimo|anker|shipping|delivery|warranty|refund|returns?|exchang\w*|in\s+(?:your|the)\s+cart|(?:added|removed)\s+(?:it|this|that|the\s+item)|in[\s-]+stock|out[\s-]+of[\s-]+stock|(?:is|are)\s+available|available\s+now|guaranteed|(?:is|are|works|fits)\s+compatible)\b/iu;
const UNVERIFIED_COMMERCE_ACTION =
  /\b(?:cancel(?:l)?ed|refunded|charged|shipped|delivered|arrived|paid)\b|\b(?:we|i|our store)\s+(?:sell|stock|carry|offer)\b|\b(?:we|i|our store)\s+have\s+(?!no\b|not\b|never\b)|\b(?:order|payment|purchase|transfer|account|transaction|receipt|checkout|cart)\b[^.!?\n]{0,80}\b(?:confirmed|processed|completed|successful|received|placed|created|generated|issued|ready|activated|settled|approved|sent)\b|\b(?:confirmed|processed|completed|placed|created|generated|issued|opened|sent)\b[^.!?\n]{0,80}\b(?:order|payment|purchase|transfer|account|transaction|receipt|checkout|cart)\b|\b(?:i|we)(?:['’](?:ve|ll)|\s+(?:have|will|just))?\s+(?:did|done|handled|completed|processed|created|issued|sent)\s+(?:it|that|this)\b/i;
const UNVERIFIED_RECOMMENDATION =
  /\b(?:(?:i|we)\s+(?:(?:would|do)\s+)?(?:recommend|suggest)\s+(?:a|an|the|buying|getting)|you\s+(?:should|could)\s+(?:buy|get|choose|consider))\b/i;
const UNVERIFIED_PRODUCT_RECOMMENDATION =
  /\b(?:recommend|suggest)\b[^.!?\n]{0,60}\b(?:phones?|smartphones?|laptops?|tablets?|cameras?|watches|smartwatches?|speakers?|consoles?|televisions?|monitors?|accessor(?:y|ies)|chargers?|cables?|adapters?|cases?|screen[\s-]*protectors?|earbuds?|headphones?|headsets?|earphones?|power[\s-]*banks?)\b/i;
const UNVERIFIED_STORE_PURCHASE =
  /\b(?:buy|purchase|order|get)\b[^.!?\n]{0,100}\b(?:from|at)\s+(?:us|our\s+(?:store|shop))\b|\b(?:ready|available)\s+(?:to|for)\s+(?:buy|purchase|order|sale)\b/i;
const UNCONFIRMED_STOCK_STATEMENT =
  /\b(?:can(?:not|['’]t)|unable\s+to)\s+(?:confirm|verify|check)\s+what(?:['’]s|\s+is)\s+in[\s-]+stock\b/gi;

type ConversationMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

function getOgabasseyConversationProviders(): TextProvider[] {
  const providers: TextProvider[] = [];
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();

  if (openaiKey) {
    providers.push({
      name: 'openai:gpt-6-luna',
      model: createOpenAICompatible({
        name: 'openai',
        baseURL: 'https://api.openai.com/v1',
        apiKey: openaiKey,
        transformRequestBody: ({ max_tokens, ...body }) => ({
          ...body,
          ...(max_tokens === undefined
            ? {}
            : { max_completion_tokens: max_tokens }),
        }),
      }).chatModel('gpt-6-luna'),
    });
  }
  if (deepseekKey) {
    providers.push({
      name: 'deepseek:deepseek-flash',
      model: createOpenAICompatible({
        name: 'deepseek',
        baseURL: 'https://api.deepseek.com',
        apiKey: deepseekKey,
      }).chatModel('deepseek-flash'),
    });
  }
  return providers;
}

/**
 * Handles only general conversation after the authoritative catalog fast path.
 * It never gives the new providers catalog or checkout tools: product cards and
 * commerce actions remain on their existing server-owned paths.
 */
export async function runOgabasseyConversation(options: {
  abortSignal: AbortSignal;
  chatProvider: AiChatProvider;
  merchantName: string;
  merchantSlug: string;
  messages: ConversationMessage[];
  timeoutMs: number;
}): Promise<Response | null> {
  if (options.merchantSlug !== 'ogabassey' || options.chatProvider !== 'auto')
    return null;

  const last = options.messages.at(-1);
  if (last?.role !== 'user') return null;
  if (isBusinessFactRequest(last.content)) {
    return new Response(
      'Please check the store’s contact page or contact support for current details.',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
  const commerceContext = resolveOgabasseyCommerceContext(options.messages);
  if (commerceContext.guarded) return null;
  // A prior commerce turn may contain personal details, even after the user
  // changes topics. Do not forward that history to the general model.
  const conversationMessages = commerceContext.promptOverride
    ? [{ role: 'user' as const, content: commerceContext.promptOverride }]
    : commerceContext.isolateHistory
      ? [last]
      : options.messages;

  const providers = getOgabasseyConversationProviders();
  if (providers.length === 0) return null;

  if (NEGOTIATION.test(last.content)) {
    return new Response(
      'I can’t promise a discount here. Please contact the store about current offers.',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  // Unsupported catalog questions must not be answered from a model's memory
  // or from untrusted client-supplied conversation history.
  const previousUsers = conversationMessages
    .filter((message) => message.role === 'user')
    .slice(-4, -1);
  const isProductFollowUp =
    (PRODUCT_REFERENCE.test(last.content) ||
      PRODUCT_AMOUNT.test(last.content)) &&
    previousUsers.some((message) => CATALOG_FACT_REQUEST.test(message.content));
  if (
    CATALOG_FACT_REQUEST.test(last.content) ||
    GENERAL_AVAILABILITY_REQUEST.test(last.content) ||
    isProductFollowUp
  ) {
    return new Response(
      'I couldn’t confirm that product here. Please check the catalog or contact the store for current details.',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  if (
    SHOPPING_ADVICE_REQUEST.test(last.content) ||
    previousUsers.some((message) =>
      SHOPPING_ADVICE_REQUEST.test(message.content)
    )
  ) {
    return new Response(
      'What type of product are you looking for, and what budget do you have in mind? I can check our catalog.',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  if (options.timeoutMs <= 0) return createStaticChatFallbackResponse();

  try {
    const result = await generateTextWithChain({
      abortSignal: options.abortSignal,
      chain: providers,
      messages: conversationMessages
        .filter((message) => message.role !== 'system')
        .slice(-10)
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.content.slice(0, 4_000),
        })),
      system:
        `${buildStorefrontDisplayData(options.merchantName)} ` +
        'Keep replies brief, friendly, and honest. You have no access to live inventory, ' +
        'current prices, product compatibility, discounts, orders, checkout, payments, or live weather. ' +
        'Never invent product recommendations, prices, availability, policies, or promises. ' +
        'Do not claim to have performed an action. For current details or offers, direct ' +
        'the customer to the storefront or store support.',
      maxOutputTokens: 256,
      perProviderTimeoutMs: PER_PROVIDER_TIMEOUT_MS,
      overallTimeoutMs: Math.min(options.timeoutMs, MAX_CHAIN_TIMEOUT_MS),
      providerOptions: {
        openai: {
          reasoningEffort: 'none',
          store: false,
          service_tier: 'default',
        },
        deepseek: { thinking: { type: 'disabled' } },
      },
      acceptResult: (text) => {
        const claimCheckText = text.replace(
          UNCONFIRMED_STOCK_STATEMENT,
          'cannot verify inventory'
        );
        return (
          !UNGROUNDED_REPLY.test(claimCheckText) &&
          !UNVERIFIED_COMMERCE_ACTION.test(text) &&
          !UNVERIFIED_RECOMMENDATION.test(text) &&
          !UNVERIFIED_PRODUCT_RECOMMENDATION.test(text) &&
          !UNVERIFIED_STORE_PURCHASE.test(text)
        );
      },
      onProviderError: (providerName, error) => {
        console.warn(
          'agentic_chat_provider',
          JSON.stringify({
            event: 'provider_error',
            provider: providerName,
            errorName:
              error instanceof Error ? error.name.slice(0, 80) : 'UnknownError',
            surface: 'ogabassey_conversation',
          })
        );
      },
    });
    console.info(
      'agentic_chat_provider',
      JSON.stringify({
        event: 'provider_success',
        provider: result.providerName,
        surface: 'ogabassey_conversation',
      })
    );
    return new Response(result.text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    if (options.abortSignal.aborted) throw error;
    return createStaticChatFallbackResponse();
  }
}
