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
  resolveConversationBudgetLimit,
} from './ogabassey-catalog-agent-budget';
import {
  hasGroundedCatalogResultText,
  hasGroundedEmptyCatalogText,
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
  resolveChainPerProviderTimeoutMs,
} from './ogabassey-model-providers';

const PER_PROVIDER_TIMEOUT_MS = 6_000;
const MAX_CHAIN_TIMEOUT_MS = 12_000;
const MAX_CATALOG_AGENT_STEPS = 5;

const catalogAgentStopWhen: StopCondition<ToolSet> = ({ steps }) =>
  steps.length >= MAX_CATALOG_AGENT_STEPS;

const COURTESY =
  /^(?:hi|hello|hey|thanks|thank\s+you|how\s+are\s+you)[\s.!?]*$/i;

const CATALOG_AGENT_CUE =
  /[₦$€£]\s*\d|\b(?:(?:show|find|list|recommend|suggest|have|sell|stock|carry|cheap\w*|affordable|budget|apple|samsung|google|sony|dell|hp|lenovo|gaming|electronic|tech|your|store|catalog)\s+(?:\w+\s+){0,2}(?:products?|devices?)|(?:products?|devices?)\s+(?:under|below|within|around|in\s+stock|available|for\s+sale)|phones?|smartphones?|iphone\w*|ipad\w*|pixel\w*|galaxy\w*|laptops?|macbooks?|notebooks?|tablets?|(?:smart)?watches?|cameras?|speakers?|consoles?|televisions?|monitors?|accessor(?:y|ies)|chargers?|cables?|adapters?|cases?|earbuds?|headphones?|airpods|power[\s-]*banks?|(?:gaming|video\s+editing|photo(?:graphy)?|editing)\s+(?:\w+\s+){0,2}(?:laptop\w*|pc|rig|setup|phone\w*|tablet\w*|camera\w*|monitor\w*|console\w*|headset\w*|gear|device\w*|spec\w*|option\w*)|(?:under|below|within|at\s+most|max(?:imum)?)\s+(?:₦|ngn\s*)?\d+(?:\.\d+)?\s*(?:m|k|million|thousand)|(?:my\s+|a\s+)?budget\s+(?:of|is|for|phone\w*|laptop\w*|device\w*)|(?:cheap\w*|affordable)\s+(?:phone\w*|laptop\w*|tablet\w*|device\w*|option\w*|item\w*|product\w*)|(?:do\s+you\s+(?:stock|carry|sell)|in\s+stock|out\s+of\s+stock))\b/i;

const FOLLOW_UP_CUE =
  /[₦$€£]|\b(?:it|this|that|these|those|one|ones|cheaper|less|more|instead|around|over-ear|wireless)\b|(?:\b(?:under|below|within|up\s+to|at\s+most|around)\s+(?:₦|ngn\s*)?)?\d+(?:\.\d+)?\s*(?:m|k|million|thousand|naira|ngn)\b/i;

const READ_ONLY_AGENT_ACTION_CLAIM =
  /\b(?:(?:i|we)(?:['’](?:ve|ll|m|re)|\s+(?:have|had|will|just|already))?\s+(?:added|removed|updated|cleared|ordered|purchased|bought|reserved|booked|placed|checked\s+out)|(?:added|removed)\b[^.!?\n]{0,60}\b(?:to|from)\s+(?:your\s+|the\s+)?cart|item\s+has\s+been\s+(?:added|ordered|purchased)|order\s+(?:has\s+been\s+)?placed)\b/i;

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

  const providers = getOgabasseyPreferredProviders({ includeDeepSeek: true });
  if (providers.length === 0 || options.timeoutMs <= 0) return null;

  const budgetLimit = resolveConversationBudgetLimit(
    conversationMessages,
    options.currencyCode
  );

  const sessionId = `catalog-readonly-${crypto.randomUUID()}`;
  let presentationCollector = createChatPresentationEventCollector();
  let toolCallsInAttempt = 0;

  const createToolsForAttempt = () => {
    const collector = createChatPresentationEventCollector();
    presentationCollector = collector;
    toolCallsInAttempt = 0;

    return buildBudgetEnforcedReadOnlyTools(
      sessionId,
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
      perProviderTimeoutMs: resolveChainPerProviderTimeoutMs(
        Math.min(options.timeoutMs, MAX_CHAIN_TIMEOUT_MS),
        providers.length,
        PER_PROVIDER_TIMEOUT_MS
      ),
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
        if (
          OGABASSEY_UNVERIFIED_MUTATION_ACTION.test(text) ||
          READ_ONLY_AGENT_ACTION_CLAIM.test(text)
        ) {
          return false;
        }
        const events = presentationCollector.getEvents();
        if (events.length === 0) {
          return (
            hasGroundedEmptyCatalogText(
              text,
              options.currencyCode,
              budgetLimit
            ) &&
            !OGABASSEY_UNVERIFIED_COMMERCE_ACTION.test(text) &&
            !OGABASSEY_UNVERIFIED_STORE_PURCHASE.test(text)
          );
        }
        return hasGroundedCatalogResultText(
          text,
          events,
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
