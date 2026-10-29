import type { AgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import {
  loadFastCatalogCategories,
  loadFastCatalogProducts,
} from './fast-catalog-data';
import { interpretFastCatalogIntent } from './fast-catalog-intent';
import {
  buildFastCatalogReply,
  type FastCatalogReply,
} from './fast-catalog-reply';
import { withTimeout } from './route-helpers';

const FAST_CATALOG_TIMEOUT_MS = 9_000;
const UNAVAILABLE: FastCatalogReply = {
  events: [],
  text: 'I couldn’t check the catalog right now. Please try again or browse the store.',
  unavailable: true,
};

export async function tryFastCatalogChat(options: {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  tenant: AgenticChatTenant;
  signal: AbortSignal;
}): Promise<FastCatalogReply | null> {
  if (
    options.tenant.merchantSlug !== 'ogabassey' ||
    options.messages.at(-1)?.role !== 'user'
  )
    return null;
  const userMessages = options.messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content);
  const latest = userMessages.at(-1)?.trim() ?? '';
  if (
    /^(?:hi|hello|hey|good morning|good afternoon|good evening)[!.\s]*$/i.test(
      latest
    )
  ) {
    return {
      events: [],
      text: 'Hello! How can I help you find a product today?',
    };
  }
  const addFollowUp =
    /\b(?:add|put)\s+(?:it|this|that|them|these|those|one)\s+(?:to|in|into)\s+(?:my\s+|the\s+)?cart\b/i.test(
      latest
    );
  const searchMessages = addFollowUp
    ? userMessages.slice(-4, -1)
    : userMessages;
  if (addFollowUp && !interpretFastCatalogIntent(searchMessages, [])) {
    return {
      events: [],
      text: 'Which product would you like to add? Please tell me its name.',
    };
  }
  if (!interpretFastCatalogIntent(searchMessages, [])) return null;
  if (options.signal.aborted) return UNAVAILABLE;

  try {
    return await withTimeout(
      (async () => {
        const categories = await loadFastCatalogCategories(
          options.tenant.merchantId
        );
        const reply = await buildFastCatalogReply(
          searchMessages,
          categories,
          (intent) => loadFastCatalogProducts(options.tenant.merchantId, intent)
        );
        if (!reply || !addFollowUp || !reply.events.length) return reply;
        return {
          ...reply,
          text: `${reply.text} Choose Add to cart on a product card or open the product page to select options.`,
        };
      })(),
      FAST_CATALOG_TIMEOUT_MS,
      'Catalog lookup timed out'
    );
  } catch {
    return UNAVAILABLE;
  }
}
