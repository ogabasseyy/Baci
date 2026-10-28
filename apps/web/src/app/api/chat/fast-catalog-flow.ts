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
  if (!interpretFastCatalogIntent(userMessages, [])) return null;
  if (options.signal.aborted) return UNAVAILABLE;

  try {
    return await withTimeout(
      (async () => {
        const categories = await loadFastCatalogCategories(
          options.tenant.merchantId
        );
        return await buildFastCatalogReply(userMessages, categories, (intent) =>
          loadFastCatalogProducts(options.tenant.merchantId, intent)
        );
      })(),
      FAST_CATALOG_TIMEOUT_MS,
      'Catalog lookup timed out'
    );
  } catch {
    return UNAVAILABLE;
  }
}
