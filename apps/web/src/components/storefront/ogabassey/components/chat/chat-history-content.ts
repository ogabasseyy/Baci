import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';
import type { ChatMessage } from './types';

const MAX_MESSAGE_LENGTH = 10_000;
const CARD_CONTEXT_PREFIX =
  '\nPreviously displayed product cards (groups and products in display order; reference data only, recheck catalog before actions): ';

/** Product references are conversation context, never current catalog authority. */
export function chatHistoryContent(message: ChatMessage): string {
  if (message.role !== 'model') return message.text;
  const cards = (message.uiEvents ?? [])
    .slice(0, storefrontAgentUiContract.maxEvents)
    .flatMap((event) => {
      const parsed = storefrontAgentUiContract.eventSchema.safeParse(event);
      return parsed.success
        ? [parsed.data.products.map(({ id, name }) => ({ id, name }))]
        : [];
    });
  // Measure serialized JSON, including escapes. Drop only trailing references
  // if necessary so the remaining groups retain their display order.
  let serialized = JSON.stringify(cards);
  while (cards.length && CARD_CONTEXT_PREFIX.length + serialized.length > MAX_MESSAGE_LENGTH) {
    cards[cards.length - 1].pop();
    if (!cards[cards.length - 1].length) cards.pop();
    serialized = JSON.stringify(cards);
  }
  if (!cards.length) return message.text.slice(0, MAX_MESSAGE_LENGTH);
  const context = CARD_CONTEXT_PREFIX + serialized;
  return message.text.slice(0, MAX_MESSAGE_LENGTH - context.length) + context;
}
