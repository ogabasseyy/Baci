import type { CatalogChatMessage } from './ogabassey-catalog-agent-budget';

const GENERIC_CATEGORY_NOUNS = new Set([
  'laptop',
  'phone',
  'smartphone',
  'tablet',
  'camera',
  'watch',
  'smartwatch',
  'audio',
  'headphone',
  'earbud',
  'speaker',
  'charger',
  'monitor',
  'console',
  'accessory',
  'accessories',
]);

const REQUEST_NOISE_WORDS = new Set([
  'carry',
  'stock',
  'have',
  'sell',
  'need',
  'want',
  'show',
  'find',
  'list',
  'recommend',
  'suggest',
  'looking',
  'for',
  'under',
  'below',
  'above',
  'over',
  'within',
  'budget',
  'around',
  'any',
  'you',
  'your',
  'the',
  'this',
  'that',
  'these',
  'those',
  'with',
  'without',
  'some',
  'more',
  'less',
  'cheaper',
  'cheapest',
  'best',
  'good',
  'available',
  'does',
  'can',
  'could',
  'would',
  'please',
  'tell',
  'what',
  'which',
  'there',
  'they',
  'them',
  'price',
  'cost',
  'ngn',
  'naira',
  'million',
  'thousand',
  'about',
  'options',
  'option',
  'item',
  'items',
  'product',
  'products',
  'device',
  'devices',
  'model',
  'models',
  'store',
  'shop',
  'buy',
  'get',
  'got',
  'still',
  'currently',
  'right',
  'now',
  'video',
  'editing',
  'photo',
  'work',
  'gaming',
  'sale',
]);

const PLURAL_CATEGORY_SINGULAR: Readonly<Record<string, string>> = {
  iphones: 'iphone',
  macbooks: 'macbook',
  ipads: 'ipad',
  pixels: 'pixel',
  laptops: 'laptop',
  phones: 'phone',
  smartphones: 'smartphone',
  tablets: 'tablet',
  notebooks: 'notebook',
  watches: 'watch',
  smartwatches: 'smartwatch',
  cameras: 'camera',
  monitors: 'monitor',
  chargers: 'charger',
  headphones: 'headphone',
  earbuds: 'earbud',
  speakers: 'speaker',
  consoles: 'console',
};

const FAMILY_TO_CATEGORY_GROUP: Readonly<Record<string, string>> = {
  macbook: 'laptop',
  notebook: 'laptop',
  thinkpad: 'laptop',
  ultrabook: 'laptop',
  laptop: 'laptop',
  iphone: 'phone',
  pixel: 'phone',
  galaxy: 'phone',
  smartphone: 'phone',
  phone: 'phone',
  ipad: 'tablet',
  tablet: 'tablet',
};

function tokenizeNormalizedTerms(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().matchAll(/[a-z0-9]+/g)) {
    const token = PLURAL_CATEGORY_SINGULAR[raw[0]] ?? raw[0];
    if (!/^(?:[a-z0-9]{3,}|\d{1,2}|[a-z]\d{1,2})$/.test(token)) continue;
    if (REQUEST_NOISE_WORDS.has(token)) continue;
    if (/^\d+(?:k|m)$/.test(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

/** Ensures recorded `searchProducts` calls match the requested item or category before accepting empty replies. */
export function hasAlignedSearchForEmptyResult(
  messages: CatalogChatMessage[],
  searchParams: Array<{ query?: string; category?: string }>
): boolean {
  if (searchParams.length === 0) return true;
  const userMessages = messages.filter((message) => message.role === 'user');
  const latest = userMessages.at(-1)?.content ?? '';
  let requestTokens = tokenizeNormalizedTerms(latest);
  if (requestTokens.length === 0 && userMessages.length > 1) {
    requestTokens = tokenizeNormalizedTerms(userMessages.at(-2)?.content ?? '');
  }
  if (requestTokens.length === 0) return true;

  const specificTokens = requestTokens.filter(
    (token) => !GENERIC_CATEGORY_NOUNS.has(token)
  );
  const requestGroups = new Set(
    requestTokens
      .map((token) => FAMILY_TO_CATEGORY_GROUP[token])
      .filter((group): group is string => Boolean(group))
  );

  return searchParams.some((params) => {
    const combined = `${params.query ?? ''} ${params.category ?? ''}`;
    const searchTokens = new Set(tokenizeNormalizedTerms(combined));
    if (specificTokens.length > 0) {
      return specificTokens.every((token) => searchTokens.has(token));
    }
    if (requestGroups.size > 0) {
      for (const token of searchTokens) {
        const group = FAMILY_TO_CATEGORY_GROUP[token];
        if (group && requestGroups.has(group)) return true;
      }
      return false;
    }
    return requestTokens.every((token) => searchTokens.has(token));
  });
}
