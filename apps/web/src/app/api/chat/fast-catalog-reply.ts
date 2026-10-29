import type { ChatProductResult } from '@/ai/chat-product-result';
import type { StorefrontAgentUiEvent } from '@/schemas/storefront-agent-ui-contract';
import { createChatPresentationEventCollector } from './create-chat-presentation-event-collector';
import {
  type FastCatalogCategory,
  type FastCatalogIntent,
  interpretFastCatalogIntent,
} from './fast-catalog-intent';

type SearchIntent = Extract<FastCatalogIntent, { kind: 'search' }>;
export interface FastCatalogReply {
  text: string;
  events: StorefrontAgentUiEvent[];
  unavailable?: boolean;
  catalogChecked?: boolean;
}

export async function buildFastCatalogReply(
  userMessages: string[],
  categories: FastCatalogCategory[],
  load: (intent: SearchIntent) => Promise<ChatProductResult[]>,
  currencyCode?: string
): Promise<FastCatalogReply | null> {
  const intent = interpretFastCatalogIntent(
    userMessages,
    categories,
    currencyCode
  );
  if (!intent) return null;
  if (intent.kind === 'clarify') {
    return {
      events: [],
      text:
        intent.reason === 'max-budget'
          ? 'Does “Max” refer to the product name or your budget? Please send the product name and use “under” for the budget.'
          : intent.reason === 'more-results'
            ? 'I can’t show another page of results in this chat. Please browse the store or refine the product, brand or budget.'
            : intent.reason === 'more-needs-search'
              ? 'Please send a new search with the product, budget and any must-have conditions, or browse the store.'
              : intent.reason === 'product-details'
                ? 'Which product would you like details about, and what would you like to know?'
                : intent.reason === 'ambiguous-budget'
                  ? 'I can’t tell whether that word is a currency or part of your product request. Please send a new message with the product and budget in the store’s currency, such as “phones at most 5000”.'
                  : intent.reason === 'currency'
                    ? 'Please reply with your maximum in the store’s currency, for example “at most 5000”. I can’t convert currencies here.'
                    : intent.reason === 'product'
                      ? 'Which product do you mean? Please tell me its name so I can check the catalog.'
                      : intent.reason === 'options'
                        ? 'I can’t confirm that condition or product option here. Please browse the store and check the available options on the product page.'
                        : 'Please send a new message with the product type and, if you have a budget, say “at most” followed by the amount.',
    };
  }

  try {
    const products = await load(intent);
    const collector = createChatPresentationEventCollector();
    collector.capture('searchProducts', { products });
    const events = collector.getEvents();
    if (products.length > 0 && events.length === 0)
      throw new Error('Catalog presentation invalid');
    if (!events.length) {
      return {
        events: [],
        catalogChecked: true,
        text: 'I couldn’t confirm a matching option in the items I checked. Try a different search or browse the store.',
      };
    }

    const names = events.flatMap((event) =>
      event.products.map((product) =>
        product.name
          .replace(/[[\]()*`!\r\n]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
    );
    const note = intent.preference
      ? ` Our catalog marks these for ${intent.preference}; they are not ranked, so compare their details before choosing.`
      : '';
    const compatibility = intent.isAccessory
      ? ' Check compatibility with your device before buying.'
      : '';
    return {
      events,
      catalogChecked: true,
      text: `Here are options from our catalog: ${names.join(', ')}.${note} Choose an option to check its current price and availability.${compatibility}`,
    };
  } catch {
    return {
      events: [],
      text: 'I couldn’t check the catalog right now. Please try again or browse the store.',
      unavailable: true,
    };
  }
}
