import type { StorefrontAgentUiEvent } from '@/schemas/storefront-agent-ui-contract';
import { analyzeFastCatalogBudget } from './fast-catalog-budget';

export interface CatalogBudgetLimit {
  amount: number;
  exclusive: boolean;
}

export type CatalogChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

const BUDGET_OVERRIDE_CUE =
  /\b(?:ignore\s+(?:the\s+|my\s+)?budget|no\s+budget|any\s+price|higher\s+budget|more\s+expensive|above|over)\b/i;

export const UNGROUNDED_EMPTY_RESULT_CLAIM = /[₦$€£]|\b(?:naira|ngn)\b/i;

const POSITIVE_EMPTY_RESULT_CLAIM =
  /\b(?:in[\s-]+stock|available\s+now|available\s+for|we\s+(?:have|stock|carry|sell|offer)|(?:is|are)\s+available|available\s+in|comes?\s+in|you\s+can\s+(?:get|buy|order)|we\s+recommend|try\s+the|here\s+(?:is|are)|check\s+out)\b/i;

const NEGATION_OR_ABSENCE_CUE =
  /\b(?:no|not|don['’]?t|do\s+not|didn['’]?t|did\s+not|couldn['’]?t|could\s+not|can['’]?t|cannot|never|none|nothing|zero|unable|without|unavailable|out\s+of\s+stock|sold\s+out)\b/i;

const CLAUSE_SPLIT_PATTERN =
  /[.!?\n;]+|\b(?:but|however|although)\b|,\s*(?=(?:we|here|try|you|the|check)\b)/i;

const PRICE_MENTION_PATTERN =
  /(?:(₦|ngn\s*|[$€£]\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km]))?|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km]))?\s*(?:naira|ngn|₦)|(\d{1,3}(?:,\d{3})+)(?:\.\d+)?)/giu;

// Only treat explicit currency, scaled, or budget-cued numbers from user turns
// as valid budget references so model numbers (e.g. "iPhone 16") never enter.
const USER_BUDGET_MENTION_PATTERN =
  /(?:(₦|ngn\s*|[$€£]\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km]))?|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:(million|thousand|[km])\b|(?=(?:\s*(?:naira|ngn|₦))))|(?:under|below|within|up\s+to|at\s+most|max(?:imum)?|budget(?:\s+(?:of|is))?)\s+((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(million|thousand|[km]))?)/giu;

const BARE_PRICE_CANDIDATE_PATTERN = /\b(\d{4,9})\b/gu;
const NON_PRICE_SPEC_SUFFIX_PATTERN =
  /^\s*(?:mah|hz|khz|mhz|ghz|nits|ppi|rpm|gb|tb|mb|kb|mp|mm|cm|w|p|x)\b/i;
const MODEL_NUMBER_PREFIX_PATTERN =
  /(?:rtx|gtx|rx|arc|ryzen|core|i\d-|snapdragon|dimensity|helio|exynos|tensor|model|gen)\s*$/i;
const PRICE_CUE_PREFIX_PATTERN =
  /(?:costs?|priced?\s+at|for|at|from|only|under|below|within|up\s+to|at\s+most|budget(?:\s+(?:of|is))?)\s*$/i;
const BUDGET_FRAME_PREFIX_PATTERN =
  /\b(?:under|below|within|up\s+to|at\s+most|max(?:imum)?|budget)\b[^.!?\n]{0,24}$/i;
const BUDGET_FRAME_SUFFIX_PATTERN = /^[^.!?\n]{0,16}\b(?:budget|limit|cap)\b/i;

const STOCK_COUNT_PATTERN =
  /\b(\d+)\s+(?:in[\s-]+stock|units?\s+(?:left|available|remaining|in[\s-]+stock))\b/giu;

const FAMILY_VARIANT_PATTERN =
  /\b(?:macbook|iphone|ipad|galaxy|pixel|xps|surface|watch)\s+(?:pro|ultra|max|mini|plus|air|studio|fold|flip|m[1-5])\b/gi;

const GENERIC_PRODUCT_NAME_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'in',
  'on',
  'of',
  'or',
  'gb',
  'tb',
  'mb',
  'ram',
  'rom',
  'ssd',
  'hdd',
  'inch',
  'inches',
  'black',
  'white',
  'blue',
  'silver',
  'gold',
  'gray',
  'grey',
  'green',
  'pink',
  'red',
  'new',
  'used',
  'edition',
  'series',
  'model',
  'wifi',
  'cellular',
  '5g',
  '4g',
  'lte',
]);

const KNOWN_BRAND_OR_LINE_TOKENS = new Set([
  'apple',
  'samsung',
  'dell',
  'hp',
  'lenovo',
  'asus',
  'acer',
  'sony',
  'google',
  'microsoft',
  'huawei',
  'xiaomi',
  'redmi',
  'poco',
  'tecno',
  'infinix',
  'itel',
  'oneplus',
  'oppo',
  'vivo',
  'realme',
  'motorola',
  'nokia',
  'lg',
  'hisense',
  'toshiba',
  'msi',
  'razer',
  'alienware',
  'jbl',
  'bose',
  'beats',
  'anker',
  'canon',
  'nikon',
  'gopro',
  'nintendo',
  'playstation',
  'xbox',
  'logitech',
  'corsair',
  'oraimo',
  'ugreen',
  'baseus',
  'starlink',
  'framework',
  'macbook',
  'iphone',
  'ipad',
  'imac',
  'airpods',
  'galaxy',
  'pixel',
  'thinkpad',
  'ideapad',
  'yoga',
  'legion',
  'xps',
  'latitude',
  'inspiron',
  'vostro',
  'precision',
  'pavilion',
  'envy',
  'spectre',
  'elitebook',
  'probook',
  'zbook',
  'victus',
  'omen',
  'zenbook',
  'vivobook',
  'rog',
  'tuf',
  'aspire',
  'swift',
  'predator',
  'nitro',
  'surface',
  'ps4',
  'ps5',
  'airtag',
  'homepod',
  'xm4',
  'xm5',
]);

function tokenizeLowerWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length >= 2
  );
}

function collectReturnedProductTokens(
  events: StorefrontAgentUiEvent[]
): Set<string> {
  const tokens = new Set<string>();
  for (const event of events) {
    for (const product of event.products) {
      const fields = [
        product.name,
        product.brand,
        product.category,
        product.description,
        product.slug,
        product.variantModel,
      ];
      for (const field of fields) {
        if (!field) continue;
        for (const token of tokenizeLowerWords(field)) {
          tokens.add(token);
        }
      }
    }
  }
  return tokens;
}

function hasGroundedProductMentions(
  text: string,
  events: StorefrontAgentUiEvent[]
): boolean {
  const products = events.flatMap((event) => event.products);
  if (products.length === 0) return false;

  const lowerText = text.toLowerCase();
  const textTokenSet = new Set(tokenizeLowerWords(text));

  const matchesReturnedProduct = products.some((product) => {
    const productName = product.name.trim().toLowerCase();
    if (productName && lowerText.includes(productName)) return true;

    const brandTokens = new Set(tokenizeLowerWords(product.brand ?? ''));
    const allNameTokens = tokenizeLowerWords(product.name).filter(
      (token) => !GENERIC_PRODUCT_NAME_WORDS.has(token)
    );
    const nonBrandTokens = allNameTokens.filter(
      (token) => !brandTokens.has(token)
    );
    const matchPool =
      nonBrandTokens.length > 0 ? nonBrandTokens : allNameTokens;
    return matchPool.some((token) => textTokenSet.has(token));
  });

  if (!matchesReturnedProduct) return false;

  const returnedTokens = collectReturnedProductTokens(events);
  const clauses = text
    .split(CLAUSE_SPLIT_PATTERN)
    .map((clause) => clause.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    if (NEGATION_OR_ABSENCE_CUE.test(clause)) continue;

    for (const token of tokenizeLowerWords(clause)) {
      if (KNOWN_BRAND_OR_LINE_TOKENS.has(token) && !returnedTokens.has(token)) {
        return false;
      }
    }

    for (const match of clause.matchAll(FAMILY_VARIANT_PATTERN)) {
      const phraseTokens = tokenizeLowerWords(match[0]);
      if (phraseTokens.some((token) => !returnedTokens.has(token))) {
        return false;
      }
    }
  }

  return true;
}

export function resolveConversationBudgetLimit(
  messages: CatalogChatMessage[],
  currencyCode: string
): CatalogBudgetLimit | undefined {
  const userMessages = messages.filter((message) => message.role === 'user');
  const latestUser = userMessages.at(-1);
  if (!latestUser) return undefined;

  const latestBudget = analyzeFastCatalogBudget(
    latestUser.content,
    currencyCode
  );
  if (latestBudget.hasBudget) {
    return !latestBudget.invalid && latestBudget.price
      ? latestBudget.price
      : undefined;
  }

  if (BUDGET_OVERRIDE_CUE.test(latestUser.content)) {
    return undefined;
  }

  for (let i = userMessages.length - 2; i >= 0; i -= 1) {
    const budget = analyzeFastCatalogBudget(
      userMessages[i].content,
      currencyCode
    );
    if (budget.hasBudget) {
      return !budget.invalid && budget.price ? budget.price : undefined;
    }
  }

  return undefined;
}

export function isProductWithinBudget(
  price: unknown,
  budget: CatalogBudgetLimit | undefined
): boolean {
  if (!budget) return true;
  if (typeof price !== 'number' || !Number.isFinite(price)) return false;
  return budget.exclusive ? price < budget.amount : price <= budget.amount;
}

export function constrainSearchParamsWithBudget<
  T extends { maxPrice?: number; minPrice?: number },
>(params: T, budget: CatalogBudgetLimit | undefined): T {
  if (!budget) return params;
  const maxPrice =
    typeof params.maxPrice === 'number' && Number.isFinite(params.maxPrice)
      ? Math.min(params.maxPrice, budget.amount)
      : budget.amount;
  const minPrice =
    typeof params.minPrice === 'number' && params.minPrice > maxPrice
      ? undefined
      : params.minPrice;

  return {
    ...params,
    maxPrice,
    minPrice,
  };
}

export function filterToolResultByBudget(
  toolName: string,
  result: unknown,
  budget: CatalogBudgetLimit | undefined
): unknown {
  if (!budget || typeof result !== 'object' || result === null) {
    return result;
  }

  if (toolName === 'searchProducts') {
    const record = result as { products?: unknown; total?: unknown };
    if (!Array.isArray(record.products)) return result;
    const filteredProducts = record.products.filter((item) => {
      if (typeof item !== 'object' || item === null) return false;
      return isProductWithinBudget((item as { price?: unknown }).price, budget);
    });
    return {
      ...record,
      products: filteredProducts,
      total: filteredProducts.length,
    };
  }

  if (toolName === 'getProductDetails') {
    const price = (result as { price?: unknown }).price;
    if (typeof price === 'number' && !isProductWithinBudget(price, budget)) {
      return null;
    }
  }

  return result;
}

export function filterSerializedSearchResultByBudget(
  rawJson: string,
  budget: CatalogBudgetLimit | undefined
): string {
  if (!budget) return rawJson;
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    const filtered = filterToolResultByBudget('searchProducts', parsed, budget);
    return JSON.stringify(filtered);
  } catch {
    return rawJson;
  }
}

export function filterSerializedDetailsResultByBudget(
  rawJson: string,
  budget: CatalogBudgetLimit | undefined
): string {
  if (!budget) return rawJson;
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    const filtered = filterToolResultByBudget(
      'getProductDetails',
      parsed,
      budget
    );
    if (filtered === null) {
      return JSON.stringify({ error: 'Product exceeds user budget' });
    }
    return rawJson;
  } catch {
    return rawJson;
  }
}

export function hasGroundedEmptyCatalogText(text: string): boolean {
  if (UNGROUNDED_EMPTY_RESULT_CLAIM.test(text)) return false;
  if (!NEGATION_OR_ABSENCE_CUE.test(text)) return false;

  const clauses = text
    .split(CLAUSE_SPLIT_PATTERN)
    .map((clause) => clause.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    if (NEGATION_OR_ABSENCE_CUE.test(clause)) continue;
    if (POSITIVE_EMPTY_RESULT_CLAIM.test(clause)) return false;
    if (
      tokenizeLowerWords(clause).some((token) =>
        KNOWN_BRAND_OR_LINE_TOKENS.has(token)
      )
    ) {
      return false;
    }
  }

  return true;
}

function applyNumericScale(rawValue: string, unit?: string): number {
  const numeric = Number(rawValue.replaceAll(',', ''));
  if (!Number.isFinite(numeric)) return Number.NaN;
  if (/^(?:m|million)$/i.test(unit ?? '')) {
    return Math.round(numeric * 1_000_000);
  }
  if (/^(?:k|thousand)$/i.test(unit ?? '')) {
    return Math.round(numeric * 1_000);
  }
  return Math.round(numeric);
}

function extractUserPriceMentions(messages: CatalogChatMessage[]): Set<number> {
  const values = new Set<number>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const match of message.content.matchAll(USER_BUDGET_MENTION_PATTERN)) {
      const rawNumber = match[2] ?? match[4] ?? match[6];
      const unit = match[3] ?? match[5] ?? match[7];
      if (!rawNumber) continue;
      const parsed = applyNumericScale(rawNumber, unit);
      if (Number.isFinite(parsed) && parsed > 0) {
        values.add(parsed);
      }
    }
  }
  return values;
}

function isBudgetRestatement(
  text: string,
  start: number,
  end: number
): boolean {
  const before = text.slice(Math.max(0, start - 32), start);
  const after = text.slice(end, Math.min(text.length, end + 24));
  return (
    BUDGET_FRAME_PREFIX_PATTERN.test(before) ||
    BUDGET_FRAME_SUFFIX_PATTERN.test(after)
  );
}

function isBareNonPriceSpec(
  text: string,
  start: number,
  end: number,
  amount: number
): boolean {
  const before = text.slice(Math.max(0, start - 24), start);
  const after = text.slice(end, Math.min(text.length, end + 16));
  if (NON_PRICE_SPEC_SUFFIX_PATTERN.test(after)) return true;
  if (MODEL_NUMBER_PREFIX_PATTERN.test(before)) return true;
  if (
    amount >= 2010 &&
    amount <= 2035 &&
    !PRICE_CUE_PREFIX_PATTERN.test(before)
  ) {
    return true;
  }
  return false;
}

export function hasGroundedCatalogResultText(
  text: string,
  events: StorefrontAgentUiEvent[],
  userMessages: CatalogChatMessage[],
  currencyCode: string,
  budgetLimit?: CatalogBudgetLimit
): boolean {
  const withinBudget = events.every((event) =>
    event.products.every((product) =>
      isProductWithinBudget(product.price, budgetLimit)
    )
  );
  if (!withinBudget) return false;

  if (!hasGroundedProductMentions(text, events)) return false;

  const allowedPrices = new Set(
    events.flatMap((event) =>
      event.products
        .map((product) => Math.round(product.price))
        .filter((price) => Number.isFinite(price) && price > 0)
    )
  );
  const userAmounts = extractUserPriceMentions(userMessages);

  if (
    currencyCode.toUpperCase() === 'NGN' &&
    /[$€£]/.test(text) &&
    !userMessages.some(
      (message) => message.role === 'user' && /[$€£]/.test(message.content)
    )
  ) {
    return false;
  }

  const checkedSpans: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(PRICE_MENTION_PATTERN)) {
    const rawNumber = match[2] ?? match[4] ?? match[6];
    const unit = match[3] ?? match[5];
    if (!rawNumber) continue;
    const amount = applyNumericScale(rawNumber, unit);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    checkedSpans.push({ start, end });
    const budgetRestatement = isBudgetRestatement(text, start, end);
    if (
      !allowedPrices.has(amount) &&
      !(budgetRestatement && userAmounts.has(amount))
    ) {
      return false;
    }
  }

  for (const match of text.matchAll(BARE_PRICE_CANDIDATE_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (checkedSpans.some((span) => start >= span.start && end <= span.end)) {
      continue;
    }
    const amount = Number(match[1]);
    if (isBareNonPriceSpec(text, start, end, amount)) continue;
    const budgetRestatement = isBudgetRestatement(text, start, end);
    if (
      !allowedPrices.has(amount) &&
      !(budgetRestatement && userAmounts.has(amount))
    ) {
      return false;
    }
  }

  const allowedStockCounts = new Set(
    events.flatMap((event) =>
      event.products
        .map((product) => product.stock)
        .filter(
          (stock): stock is number =>
            typeof stock === 'number' && Number.isFinite(stock)
        )
    )
  );
  for (const match of text.matchAll(STOCK_COUNT_PATTERN)) {
    const claimedStock = Number(match[1]);
    if (!allowedStockCounts.has(claimedStock)) {
      return false;
    }
  }

  return true;
}
