const STOP_WORDS = new Set([
  'a',
  'about',
  'add',
  'an',
  'and',
  'any',
  'are',
  'at',
  'availability',
  'available',
  'bag',
  'basket',
  'be',
  'buy',
  'can',
  'cart',
  'check',
  'checkout',
  'cost',
  'could',
  'currently',
  'deliver',
  'delivery',
  'did',
  'do',
  'does',
  'ekaette',
  'for',
  'from',
  'full',
  'get',
  'got',
  'have',
  'hello',
  'help',
  'here',
  'hey',
  'hi',
  'how',
  'i',
  'id',
  'ill',
  'in',
  'installment',
  'installments',
  'into',
  'is',
  'it',
  'looking',
  'me',
  'much',
  'my',
  'need',
  'now',
  'of',
  'ogabassey',
  'ok',
  'okay',
  'on',
  'one',
  'option',
  'options',
  'or',
  'order',
  'out',
  'pay',
  'place',
  'please',
  'pls',
  'price',
  'prices',
  'purchase',
  'put',
  'right',
  'ship',
  'shipping',
  'shop',
  'show',
  'small',
  'some',
  'still',
  'stock',
  'store',
  'sure',
  'take',
  'tell',
  'thank',
  'thanks',
  'that',
  'the',
  'these',
  'this',
  'those',
  'to',
  'today',
  'u',
  'want',
  'wanted',
  'was',
  'we',
  'were',
  'what',
  'which',
  'will',
  'with',
  'would',
  'yeah',
  'yep',
  'yes',
  'you',
  'your',
]);

const MAX_EXTRACTED_TOKENS = 8;

/**
 * Extracts concise catalog search terms from a conversational customer message
 * when raw full-sentence search returns no matches.
 */
export function extractChatCatalogSearchQuery(question: string): string {
  const withoutTags = question.replace(/\[[^\]]*\]/g, ' ');
  const cleaned = withoutTags
    .replace(/['’](?:ll|ve|re|m|d|s)\b/gi, '')
    .replace(/[^a-zA-Z0-9+/\-\s]/g, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => {
      if (!token) return false;
      return !STOP_WORDS.has(token.toLowerCase());
    })
    .slice(0, MAX_EXTRACTED_TOKENS);

  // Require at least one alphabetic product/brand token so bare references like "the 13"
  // fall through to conversation history or the model's cartProductQuery.
  if (!tokens.some((token) => /[a-z]{2,}/i.test(token))) {
    return '';
  }

  return tokens.join(' ');
}

export async function searchChatCatalogWithFallback<
  T extends { products: readonly unknown[] },
>(input: {
  question: string;
  history: readonly { role: string; content: string }[];
  search: (query: string) => Promise<T>;
}): Promise<T> {
  const tryWithExtracted = async (raw: string): Promise<T> => {
    const found = await input.search(raw);
    if (found.products.length > 0) return found;
    const extracted = extractChatCatalogSearchQuery(raw);
    if (extracted && extracted.toLowerCase() !== raw.trim().toLowerCase()) {
      return await input.search(extracted);
    }
    return found;
  };

  const primary = await tryWithExtracted(input.question);
  if (primary.products.length > 0) return primary;

  const previousUserTurn = input.history.findLast(
    (turn) =>
      turn.role === 'user' &&
      turn.content.trim().length > 0 &&
      turn.content.trim() !== input.question.trim()
  );
  if (!previousUserTurn) return primary;
  return await tryWithExtracted(previousUserTurn.content);
}
