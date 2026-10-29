import { resolveCatalogContext } from './fast-catalog-context';
import * as catalogLanguage from './fast-catalog-language';

export interface FastCatalogCategory {
  id: string;
  name: string;
  slug: string;
}

export type FastCatalogIntent =
  | { kind: 'clarify'; reason?: 'options' | 'product' | 'max-budget' }
  | {
      kind: 'search';
      categoryId?: string;
      query: string;
      maxPrice?: number;
      exclusiveMaxPrice?: boolean;
      wifiOnly: boolean;
      isPhoneCategory: boolean;
      isAccessory?: boolean;
      phoneProtectiveAccessory?: boolean;
      wirelessEarbudsOnly?: boolean;
      phoneCategoryIds?: string[];
      preference?: string;
    };

const CONTEXTUAL_PRICE =
  /^(?:how much(?:\s+(?:is|for)\s+(?:it|that|this))?|what(?:['’]s| is)\s+(?:the\s+)?(?:price|cost)(?:\s+(?:(?:of|for)\s+)?(?:it|that|this))?|(?:the\s+)?(?:price|cost))[?!.\s]*$/i;
const SHOPPING_REQUEST =
  /\b(?:recommend|recommendation|suggest|looking for|buy|shop|do\s+you\s+(?:have|sell|carry|stock)|have\s+you\s+got|price|cost|how much|phone|phones|smartphone|smartphones|iphones?|pixel|laptop|laptops|macbook|tablet|tablets|ipad|galaxy\s+(?:[samf]\s*\d+|z\s*(?:fold|flip)\s*\d+))\b/i;
const FOLLOW_UP =
  /\b(?:under|below|budget|within|up\s+to|at\s+most|maximum|max|cheaper|cheapest|less|more|instead|wifi|wi-fi|used|new|gaming|camera|battery)\b/i;
const BUDGET_WORD =
  /\b(?:under|below|budget|within|less than|up to|at most|maximum|max|between)\b/i;
const MAX_PRICE =
  /\b(?:under|below|budget(?:\s+(?:of|is))?|within|less than|up to|at most|maximum|max)\s*(?:₦|ngn\s*|n(?=\d))?\s*([\d,]+(?:\.\d+)?)\s*(million|thousand|[km])?\b/i;
const PHONE_SIGNAL =
  /\b(?:smartphones?|phones?|iphones?|pixel|galaxy\s+(?:[samf]\s*\d+|z\s*(?:fold|flip)\s*\d+))\b/i;
const LAPTOP_SIGNAL = /\b(?:laptops?|macbook|notebook)\b/i;
const TABLET_SIGNAL = /\b(?:tablets?|ipad)\b/i;
const ACCESSORY_SIGNAL =
  /\b(?:airpods|earbuds?|headphones?|headsets?|earphones?|chargers?|cables?|adapters?|power[\s-]*banks?|cases?|screen[\s-]*protectors?|speakers?)\b/i;

// Preserve "Max" in named models while allowing it as a budget cue after
// generic product requests and use-case descriptions.
function isProductModelMax(text: string, index: number): boolean {
  const prefix = text.slice(0, index);
  if (
    /\b(?:phones?|smartphones?|iphones?|laptops?|macbooks?|tablets?|ipads?|earbuds?|headphones?|chargers?|accessor(?:y|ies)|products?|devices?)\s+(?:for|with)\s+[\p{L}\p{N}\s,'’-]{1,80}$/iu.test(
      prefix
    )
  )
    return false;
  const previousWord = prefix.match(/[\p{L}\p{N}-]+\s*$/u)?.[0].trim();
  return (
    !!previousWord &&
    !/^(?:a|an|the|my|your|our|with|at|for|of|is|be|have|has|need|want|max|limit|under|below|within|budget|price|cost|spend|phones?|smartphones?|laptops?|tablets?|earbuds?|headphones?|chargers?|accessor(?:y|ies)|products?|devices?)$/i.test(
      previousWord
    )
  );
}

function isBudgetMatch(text: string, match: string, index: number): boolean {
  return !/^max\b/i.test(match) || !isProductModelMax(text, index);
}

export function normalizeAccessoryNouns(value: string): string {
  return value.replace(
    /\b(?:chargers|cables|adapters|cases|headphones|headsets|earphones|earbuds|speakers|banks|protectors)\b/gi,
    (word) => word.slice(0, -1)
  );
}

function resolveCategory(text: string, categories: FastCatalogCategory[]) {
  // "iPhone charger" and "phone case" ask for accessories, not phones.
  if (ACCESSORY_SIGNAL.test(text)) {
    if (/\bearbuds?\b/i.test(text)) {
      return categories.find(
        (candidate) => candidate.slug.toLowerCase() === 'earbuds'
      );
    }
    return /\b(?:chargers?|cables?|adapters?|cases?|screen[\s-]*protectors?|power[\s-]*banks?)\b/i.test(
      text
    )
      ? categories.find(
          (candidate) => candidate.slug.toLowerCase() === 'accessories'
        )
      : undefined;
  }
  const aliases = PHONE_SIGNAL.test(text)
    ? ['smartphones', 'mobile-phones', 'phones']
    : LAPTOP_SIGNAL.test(text)
      ? ['laptops', 'notebooks']
      : TABLET_SIGNAL.test(text)
        ? ['tablets']
        : [];
  return categories.find((category) =>
    aliases.includes(category.slug.toLowerCase())
  );
}

function getMaximumPrice(
  text: string
): { amount: number; exclusive: boolean } | undefined {
  const match = [...text.matchAll(new RegExp(MAX_PRICE.source, 'gi'))]
    .filter((candidate) => isBudgetMatch(text, candidate[0], candidate.index))
    .at(-1);
  if (!match) return undefined;
  const amount = Number(match[1].replaceAll(',', ''));
  const multiplier = /^(?:m|million)$/i.test(match[2] ?? '')
    ? 1_000_000
    : /^(?:k|thousand)$/i.test(match[2] ?? '')
      ? 1_000
      : 1;
  const price = amount * multiplier;
  return Number.isFinite(price) && price > 0 && price <= 1_000_000_000_000
    ? {
        amount: price,
        exclusive: /^(?:under|below|less than)\b/i.test(match[0]),
      }
    : undefined;
}

function searchText(text: string): string {
  return normalizeAccessoryNouns(
    catalogLanguage.stripRelativePricePhrases(
      catalogLanguage.normalizeUseCasePhrases(text)
    )
  )
    .replace(/\biphones\b/gi, 'iPhone')
    .replace(/\bi['’](?:m|d|ll|ve)\b/gi, ' ')
    .replace(
      new RegExp(MAX_PRICE.source, 'gi'),
      (match, _amount, _suffix, index, source) =>
        isBudgetMatch(source, match, index) ? ' ' : match
    )
    .replace(
      /\b(?:(?:not|no|without|avoid|exclude|except|never|don'?t)\s+)?wi[\s-]*fi[\s-]*only\b/gi,
      ' '
    )
    .replace(
      /\b(?:show|me|find|please|recommend|recommendation|suggest|looking|for|buy|order|shop|sell|carry|best|good|great|cheap|affordable|gaming|camera|with|under|actually|instead|about|smartphones?|phones?|laptops?|tablets?|a|an|the|my|what|which|is|am|are|available|can|i|need|want|get|got|do|does|you|have|of|and|how|much|price|cost|any|in|store|to|it|that|this)\b/gi,
      ' '
    )
    .replace(/\bbattery\b(?!\s+(?:charger|case)\b)/gi, ' ')
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function interpretFastCatalogIntent(
  userMessages: string[],
  categories: FastCatalogCategory[]
): FastCatalogIntent | null {
  const latest = userMessages.at(-1)?.trim() ?? '';
  const isShoppingRequest = (value: string) =>
    SHOPPING_REQUEST.test(value) || ACCESSORY_SIGNAL.test(value);
  const isRefinement = (value: string) =>
    FOLLOW_UP.test(value) || getMaximumPrice(value) !== undefined;
  const context = resolveCatalogContext(userMessages, {
    isShopping: (value) =>
      isShoppingRequest(value) &&
      (!isRefinement(value) ||
        [PHONE_SIGNAL, LAPTOP_SIGNAL, TABLET_SIGNAL, ACCESSORY_SIGNAL].some(
          (signal) => signal.test(value)
        ) ||
        Boolean(searchText(value))),
    isPriceFollowUp: (value) => CONTEXTUAL_PRICE.test(value),
    isRefinement,
    isBoundary: catalogLanguage.isCatalogBoundary,
  });
  if (!context) return null;
  const { text, priceFollowUp } = context;
  if (catalogLanguage.hasNegatedBudget(text))
    return { kind: 'clarify', reason: 'options' };
  if (
    catalogLanguage.isRelativePriceRequest(latest) &&
    getMaximumPrice(latest) === undefined
  )
    return { kind: 'clarify' };
  if (
    [...latest.matchAll(new RegExp(BUDGET_WORD.source, 'gi'))].some((match) =>
      isBudgetMatch(latest, match[0], match.index)
    ) &&
    getMaximumPrice(latest) === undefined
  )
    return { kind: 'clarify' };
  // Clarify whether Max is a model or a price limit before searching.
  if (
    [...text.matchAll(new RegExp(MAX_PRICE.source, 'gi'))].some(
      (match) =>
        /^max\b/i.test(match[0]) &&
        isProductModelMax(text, match.index) &&
        (/₦|\bngn|\bn(?=\d)/i.test(match[0]) ||
          !!match[2] ||
          Number(match[1].replaceAll(',', '')) >= 1000)
    )
  )
    return { kind: 'clarify', reason: 'max-budget' };

  const category = resolveCategory(text, categories);
  const priceLimit = getMaximumPrice(latest) ?? getMaximumPrice(text);
  const wirelessEarbudsOnly =
    category?.slug.toLowerCase() === 'earbuds' &&
    /\b(?:wireless|bluetooth)\b/i.test(text);
  if (
    wirelessEarbudsOnly &&
    /(?:\b(?:not|no|without|avoid|exclude|except|never|non|don['’]?t|doesn['’]?t|isn['’]?t|aren['’]?t|instead\s+of|rather\s+than|other\s+than)\b|\bnon[\s-]*(?:wireless|bluetooth)\b)/i.test(
      text
    )
  ) {
    return { kind: 'clarify', reason: 'options' };
  }
  const searchInput = wirelessEarbudsOnly
    ? text.replace(/\b(?:true\s+)?(?:wireless|bluetooth)\b/gi, ' ')
    : text;
  const query =
    category?.slug.toLowerCase() === 'earbuds'
      ? searchText(searchInput)
          .replace(/\bearbud\b/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : searchText(searchInput);
  if (priceFollowUp && !query) return { kind: 'clarify', reason: 'product' };
  if (
    !category &&
    !query &&
    ![PHONE_SIGNAL, LAPTOP_SIGNAL, TABLET_SIGNAL, ACCESSORY_SIGNAL].some(
      (signal) => signal.test(text)
    )
  )
    return null;
  if (
    (!category && !query) ||
    [PHONE_SIGNAL, LAPTOP_SIGNAL, TABLET_SIGNAL].filter((signal) =>
      signal.test(text)
    ).length > 1 ||
    /\b(?:between|over|above|at least|more than)\b/i.test(text) ||
    (priceLimit === undefined &&
      [...text.matchAll(new RegExp(BUDGET_WORD.source, 'gi'))].some((match) =>
        isBudgetMatch(text, match[0], match.index)
      ))
  ) {
    return { kind: 'clarify' };
  }
  const preferences = new Set(
    (
      catalogLanguage
        .catalogPreferenceText(text)
        .match(/\b(?:gaming|camera|battery)\b/gi) ?? []
    ).map((value) => value.toLowerCase())
  );
  if (
    catalogLanguage.uncheckedOption.test(text) ||
    preferences.size > 1 ||
    (preferences.size > 0 &&
      /\b(?:not|no|without|avoid|exclude|except|never|don'?t)\b/i.test(text))
  )
    return { kind: 'clarify', reason: 'options' };
  const { wifiOnly, otherNegation } = catalogLanguage.resolveWifiOnly(text);
  if (wifiOnly && otherNegation) {
    return { kind: 'clarify', reason: 'options' };
  }
  if (wifiOnly && !PHONE_SIGNAL.test(text))
    return { kind: 'clarify', reason: 'options' };
  const phoneCategoryIds = categories
    .filter((candidate) =>
      ['smartphones', 'mobile-phones', 'phones'].includes(
        candidate.slug.toLowerCase()
      )
    )
    .map((candidate) => candidate.id);
  if (!category && categories.length > 0 && phoneCategoryIds.length === 0) {
    return { kind: 'clarify', reason: 'options' };
  }
  const preference = preferences.values().next().value;
  return {
    kind: 'search',
    ...(category ? { categoryId: category.id } : {}),
    query,
    ...(priceLimit === undefined
      ? {}
      : {
          maxPrice: priceLimit.amount,
          exclusiveMaxPrice: priceLimit.exclusive,
        }),
    wifiOnly,
    isPhoneCategory: !!category && phoneCategoryIds.includes(category.id),
    ...(ACCESSORY_SIGNAL.test(text) ? { isAccessory: true } : {}),
    ...(wirelessEarbudsOnly ? { wirelessEarbudsOnly: true } : {}),
    ...(/\b(?:cases?|screen[\s-]*protectors?)\b/i.test(text) &&
    PHONE_SIGNAL.test(text)
      ? { phoneProtectiveAccessory: true }
      : {}),
    ...(!category ? { phoneCategoryIds } : {}),
    ...(preference ? { preference } : {}),
  };
}
