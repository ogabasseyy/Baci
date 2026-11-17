import type { StopCondition, ToolSet } from 'ai';
import { generateTextWithChain } from '@/ai/generate-text-with-chain';
import type { AiChatProvider } from '@/env';
import { buildStorefrontDisplayData } from '@/lib/agentic/storefront-display-data';
import type { StorefrontAgentUiEvent } from '@/schemas/storefront-agent-ui-contract';
import { createAiSdkAgenticChatTools } from './chat-tool-runtime';
import { createChatPresentationEventCollector } from './create-chat-presentation-event-collector';
import { isBusinessFactRequest } from './fast-catalog-language';
import {
  type CatalogBudgetLimit,
  type CatalogChatMessage,
  constrainSearchParamsWithBudget,
  filterSerializedDetailsResultByBudget,
  filterSerializedSearchResultByBudget,
  filterToolResultByBudget,
  hasGroundedCatalogResultText,
  hasGroundedEmptyCatalogText,
  resolveConversationBudgetLimit,
} from './ogabassey-catalog-agent-grounding';
import {
  isIndependentTopic,
  resolveOgabasseyCommerceContext,
} from './ogabassey-commerce-context';
import {
  getOgabasseyPreferredProviders,
  OGABASSEY_MODEL_PROVIDER_OPTIONS,
  OGABASSEY_NEGOTIATION,
  OGABASSEY_UNVERIFIED_COMMERCE_ACTION,
  OGABASSEY_UNVERIFIED_MUTATION_ACTION,
  OGABASSEY_UNVERIFIED_STORE_PURCHASE,
} from './ogabassey-model-providers';

const PER_PROVIDER_TIMEOUT_MS = 6_000;
const MAX_CHAIN_TIMEOUT_MS = 12_000;
const MAX_CATALOG_AGENT_STEPS = 3;

const catalogAgentStopWhen: StopCondition<ToolSet> = ({ steps }) =>
  steps.length >= MAX_CATALOG_AGENT_STEPS;

const COURTESY =
  /^(?:hi|hello|hey|thanks|thank\s+you|how\s+are\s+you)[\s.!?]*$/i;

const CATALOG_AGENT_CUE =
  /[₦$€£]|\b(?:recommend\w*|suggest\w*|looking\s+for|find|show|need|want|buy|shop|gifts?|present|products?|devices?|phones?|smartphones?|iphone\w*|ipad\w*|laptops?|macbooks?|notebooks?|tablets?|watches|smartwatches?|cameras?|speakers?|consoles?|televisions?|monitors?|accessor(?:y|ies)|chargers?|cables?|adapters?|cases?|earbuds?|headphones?|airpods|power[\s-]*banks?|under|below|within|budget|at\s+most|max(?:imum)?|cheap\w*|affordable|available|availability|stock|price|cost|do\s+you\s+(?:have|stock|carry|sell)|have\s+you\s+got)\b/i;

const FOLLOW_UP_CUE =
  /\b(?:it|this|that|these|those|one|ones|cheaper|less|more|instead|around)\b|[₦$€£\d]/i;

export interface OgabasseyCatalogAgentResult {
  text: string;
  events: StorefrontAgentUiEvent[];
}

function shouldAttemptCatalogAgent(messages: CatalogChatMessage[]): boolean {
  const userMessages = messages.filter((message) => message.role === 'user');
  const last = userMessages.at(-1);
  if (!last) return false;
  if (CATALOG_AGENT_CUE.test(last.content)) return true;

  const previousUsers = userMessages.slice(-4, -1);
  return (
    FOLLOW_UP_CUE.test(last.content) &&
    previousUsers.some((message) => CATALOG_AGENT_CUE.test(message.content))
  );
}

function buildBudgetEnforcedReadOnlyTools(
  sessionId: string,
  budgetLimit: CatalogBudgetLimit | undefined,
  onCapturedResult: (
    toolName: string,
    filteredResult: unknown,
    context?: { quantity?: number }
  ) => void
) {
  const readOnlyTools = createAiSdkAgenticChatTools(sessionId, {
    agenticCheckoutEnabled: false,
    onToolResult: (toolName, toolResult, context) => {
      onCapturedResult(
        toolName,
        filterToolResultByBudget(toolName, toolResult, budgetLimit),
        context
      );
    },
  });

  const baseSearchTool = readOnlyTools.searchProducts;
  const searchProducts =
    typeof baseSearchTool.execute === 'function'
      ? {
          ...baseSearchTool,
          execute: async (
            params: Parameters<typeof baseSearchTool.execute>[0]
          ) => {
            const rawJson = await baseSearchTool.execute(
              constrainSearchParamsWithBudget(params, budgetLimit)
            );
            return filterSerializedSearchResultByBudget(rawJson, budgetLimit);
          },
        }
      : baseSearchTool;

  const baseDetailsTool = readOnlyTools.getProductDetails;
  const getProductDetails =
    typeof baseDetailsTool.execute === 'function'
      ? {
          ...baseDetailsTool,
          execute: async (
            params: Parameters<typeof baseDetailsTool.execute>[0]
          ) => {
            const rawJson = await baseDetailsTool.execute(params);
            return filterSerializedDetailsResultByBudget(rawJson, budgetLimit);
          },
        }
      : baseDetailsTool;

  return { searchProducts, getProductDetails };
}

/**
 * Fallback read-only catalog search agent for Ogabassey queries that the
 * deterministic fast-catalog regex path did not recognize.
 *
 * Exposes only `searchProducts` and `getProductDetails` so natural-language
 * shopping requests (e.g. use-cases, typos, plurals) still run against live
 * catalog data while keeping all prices, budgets, product cards, and commerce
 * actions strictly server-owned.
 */
export async function runOgabasseyCatalogAgent(options: {
  abortSignal: AbortSignal;
  chatProvider: AiChatProvider;
  currencyCode: string;
  merchantName: string;
  merchantSlug: string;
  messages: CatalogChatMessage[];
  timeoutMs: number;
}): Promise<OgabasseyCatalogAgentResult | null> {
  if (options.merchantSlug !== 'ogabassey' || options.chatProvider !== 'auto') {
    return null;
  }

  const last = options.messages.at(-1);
  if (last?.role !== 'user') return null;
  if (
    isBusinessFactRequest(last.content) ||
    OGABASSEY_NEGOTIATION.test(last.content) ||
    isIndependentTopic(last.content) ||
    COURTESY.test(last.content.trim())
  ) {
    return null;
  }

  const commerceContext = resolveOgabasseyCommerceContext(options.messages);
  if (commerceContext.guarded) return null;

  const conversationMessages = commerceContext.isolateHistory
    ? [last]
    : options.messages;
  if (!shouldAttemptCatalogAgent(conversationMessages)) return null;

  const providers = getOgabasseyPreferredProviders({ includeDeepSeek: false });
  if (providers.length === 0 || options.timeoutMs <= 0) return null;

  const budgetLimit = resolveConversationBudgetLimit(
    conversationMessages,
    options.currencyCode
  );

  let presentationCollector = createChatPresentationEventCollector();
  let toolCallsInAttempt = 0;

  const createToolsForAttempt = () => {
    const collector = createChatPresentationEventCollector();
    presentationCollector = collector;
    toolCallsInAttempt = 0;

    return buildBudgetEnforcedReadOnlyTools(
      'catalog-readonly',
      budgetLimit,
      (toolName, filteredResult, context) => {
        toolCallsInAttempt += 1;
        collector.capture(toolName, filteredResult, context);
      }
    );
  };

  try {
    const result = await generateTextWithChain({
      abortSignal: options.abortSignal,
      chain: providers,
      createToolsForAttempt,
      maxOutputTokens: 256,
      messages: conversationMessages
        .filter((message) => message.role !== 'system')
        .slice(-8)
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.content.slice(0, 4_000),
        })),
      overallTimeoutMs: Math.min(options.timeoutMs, MAX_CHAIN_TIMEOUT_MS),
      perProviderTimeoutMs: PER_PROVIDER_TIMEOUT_MS,
      providerOptions: OGABASSEY_MODEL_PROVIDER_OPTIONS,
      stopWhen: catalogAgentStopWhen,
      system:
        `${buildStorefrontDisplayData(options.merchantName)} ` +
        `You are a read-only product search assistant. Currency is ${options.currencyCode}. ` +
        'Always call searchProducts first before answering any product, availability, or price question. ' +
        'Pass singular search terms (e.g. "MacBook", not "MacBooks") and convert budget shorthand ("2m" -> 2000000, "500k" -> 500000) into maxPrice/minPrice. ' +
        'Never invent products, prices, or stock levels that were not returned by searchProducts or getProductDetails. ' +
        'Never claim to add items to cart, cancel orders, or generate bank accounts. Keep replies brief.',
      acceptResult: (text) => {
        if (toolCallsInAttempt === 0) return false;
        if (OGABASSEY_UNVERIFIED_MUTATION_ACTION.test(text)) {
          return false;
        }
        const events = presentationCollector.getEvents();
        if (events.length === 0) {
          return (
            hasGroundedEmptyCatalogText(text) &&
            !OGABASSEY_UNVERIFIED_COMMERCE_ACTION.test(text) &&
            !OGABASSEY_UNVERIFIED_STORE_PURCHASE.test(text)
          );
        }
        return hasGroundedCatalogResultText(
          text,
          events,
          conversationMessages,
          options.currencyCode,
          budgetLimit
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
            surface: 'ogabassey_catalog_agent',
          })
        );
      },
    });

    console.info(
      'agentic_chat_provider',
      JSON.stringify({
        event: 'provider_success',
        provider: result.providerName,
        surface: 'ogabassey_catalog_agent',
      })
    );

    return {
      text: result.text,
      events: presentationCollector.getEvents(),
    };
  } catch (error) {
    if (options.abortSignal.aborted) throw error;
    return null;
  }
}
