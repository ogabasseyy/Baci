import type { StopCondition, ToolSet } from 'ai';
import { generateTextWithChain } from '@/ai/generate-text-with-chain';
import type { AiChatProvider } from '@/env';
import { buildStorefrontDisplayData } from '@/lib/agentic/storefront-display-data';
import type { StorefrontAgentUiEvent } from '@/schemas/storefront-agent-ui-contract';
import { createReadOnlyCatalogTools } from './chat-catalog-tools';
import { createChatPresentationEventCollector } from './create-chat-presentation-event-collector';
import { isBusinessFactRequest } from './fast-catalog-language';
import {
  type CatalogBudgetLimit,
  type CatalogChatMessage,
  constrainSearchParamsWithBudget,
  filterSerializedDetailsResultByBudget,
  filterSerializedSearchResultByBudget,
  filterToolResultByBudget,
  hasInvalidLatestBudget,
  resolveConversationBudgetLimit,
} from './ogabassey-catalog-agent-budget';
import {
  hasGroundedCatalogResultText,
  hasGroundedEmptyCatalogText,
} from './ogabassey-catalog-agent-grounding';
import {
  AGENT_COURTESY_PATTERN,
  READ_ONLY_AGENT_ACTION_CLAIM,
  shouldAttemptCatalogAgent,
} from './ogabassey-catalog-agent-lexicon';
import { hasAlignedSearchForEmptyResult } from './ogabassey-catalog-agent-search-alignment';
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

export interface OgabasseyCatalogAgentResult {
  text: string;
  events: StorefrontAgentUiEvent[];
}

function buildBudgetEnforcedReadOnlyTools(
  sessionId: string,
  budgetLimit: CatalogBudgetLimit | undefined,
  onCapturedResult: (
    toolName: string,
    filteredResult: unknown,
    context?: { quantity?: number }
  ) => void,
  onSearchParams?: (params: { query?: string; category?: string }) => void
) {
  const readOnlyTools = createReadOnlyCatalogTools(sessionId, {
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
            onSearchParams?.({
              query:
                typeof params.query === 'string' ? params.query : undefined,
              category:
                typeof params.category === 'string'
                  ? params.category
                  : undefined,
            });
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

/** Fallback read-only catalog search agent when deterministic fast-catalog misses. */
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
    AGENT_COURTESY_PATTERN.test(last.content.trim())
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
  if (hasInvalidLatestBudget(conversationMessages, options.currencyCode)) {
    return null;
  }

  const budgetLimit = resolveConversationBudgetLimit(
    conversationMessages,
    options.currencyCode
  );

  const sessionId = `catalog-readonly-${crypto.randomUUID()}`;
  let activeAttempt = {
    collector: createChatPresentationEventCollector(),
    searchCalls: 0,
    searchParams: [] as Array<{ query?: string; category?: string }>,
    toolCalls: 0,
  };

  const createToolsForAttempt = () => {
    const attempt = {
      collector: createChatPresentationEventCollector(),
      searchCalls: 0,
      searchParams: [] as Array<{ query?: string; category?: string }>,
      toolCalls: 0,
    };
    activeAttempt = attempt;

    return buildBudgetEnforcedReadOnlyTools(
      sessionId,
      budgetLimit,
      (toolName, filteredResult, context) => {
        if (activeAttempt !== attempt) return;
        attempt.toolCalls += 1;
        if (toolName === 'searchProducts') {
          attempt.searchCalls += 1;
        }
        attempt.collector.capture(toolName, filteredResult, context);
      },
      (params) => {
        if (activeAttempt === attempt) {
          attempt.searchParams.push(params);
        }
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
        if (activeAttempt.toolCalls === 0) return false;
        if (
          OGABASSEY_UNVERIFIED_MUTATION_ACTION.test(text) ||
          READ_ONLY_AGENT_ACTION_CLAIM.test(text)
        ) {
          return false;
        }
        const events = activeAttempt.collector.getEvents();
        if (events.length === 0) {
          if (activeAttempt.searchCalls === 0) return false;
          if (
            !hasAlignedSearchForEmptyResult(
              conversationMessages,
              activeAttempt.searchParams
            )
          ) {
            return false;
          }
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
      events: activeAttempt.collector.getEvents(),
    };
  } catch (error) {
    if (options.abortSignal.aborted) throw error;
    return null;
  }
}
