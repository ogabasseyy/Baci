import { analyzeFastCatalogBudget } from './fast-catalog-budget';
import { resolveCatalogContext } from './fast-catalog-context';
import * as catalogLanguage from './fast-catalog-language';

export interface FastCatalogCategory {
  id: string;
  name: string;
  slug: string;
}

export type FastCatalogIntent =
  | {
      kind: 'clarify';
      reason?:
        | 'options'
        | 'product'
        | 'max-budget'
        | 'currency'
        | 'ambiguous-budget';
    }
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
const PHONE_SIGNAL =
  /\b(?:smartphones?|phones?|iphones?|pixel|galaxy\s+(?:[samf]\s*\d+|z\s*(?:fold|flip)\s*\d+))\b/i;
const LAPTOP_SIGNAL = /\b(?:laptops?|macbook|notebook)\b/i;
const TABLET_SIGNAL = /\b(?:tablets?|ipad)\b/i;
const ACCESSORY_SIGNAL =
  /\b(?:airpods|earbuds?|headphones?|headsets?|earphones?|chargers?|cables?|adapters?|power[\s-]*banks?|cases?|screen[\s-]*protectors?|speakers?)\b/i;

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

function searchText(text: string): string {
  return normalizeAccessoryNouns(
    catalogLanguage.stripRelativePricePhrases(
      catalogLanguage.normalizeUseCasePhrases(
        analyzeFastCatalogBudget(text).searchText
      )
    )
  )
    .replace(/\biphones\b/gi, 'iPhone')
    .replace(/\bi['’](?:m|d|ll|ve)\b/gi, ' ')
    .replace(
      /\b(?:(?:not|no|without|avoid|exclude|except|never|don'?t)\s+)?wi[\s-]*fi[\s-]*only\b/gi,
      ' '
    )
    .replace(/\ball\s+(?:brands?|models?)\b/gi, ' ')
    .replace(/\bbrands\b/gi, ' ')
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
  categories: FastCatalogCategory[],
  currencyCode?: string
): FastCatalogIntent | null {
  const latest = userMessages.at(-1)?.trim() ?? '';
  const isShoppingRequest = (value: string) =>
    SHOPPING_REQUEST.test(value) || ACCESSORY_SIGNAL.test(value);
  const isRefinement = (value: string) =>
    FOLLOW_UP.test(value) || analyzeFastCatalogBudget(value).hasBudget;
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
  const latestBudget = analyzeFastCatalogBudget(latest, currencyCode);
  const contextualBudget = analyzeFastCatalogBudget(text, currencyCode);
  const unverifiedTopBrands = [...text.matchAll(/\b(top)\s+brands?\b/gi)].some(
    (match) => match[1] !== 'TOP'
  );
  const unconsumedUppercaseTop = /\bTOP\s+brands?\b/i.test(
    contextualBudget.searchText
  );
  if (unverifiedTopBrands || unconsumedUppercaseTop)
    return { kind: 'clarify', reason: 'options' };
  if (latestBudget.ambiguousCurrency || contextualBudget.ambiguousCurrency)
    return { kind: 'clarify', reason: 'ambiguous-budget' };
  if (catalogLanguage.hasNegatedBudget(text))
    return { kind: 'clarify', reason: 'options' };
  if (latestBudget.unsupportedCurrency || contextualBudget.unsupportedCurrency)
    return { kind: 'clarify', reason: 'currency' };
  if (latestBudget.invalid || contextualBudget.invalid)
    return { kind: 'clarify' };
  if (
    catalogLanguage.isRelativePriceRequest(latest) &&
    latestBudget.price === undefined
  )
    return { kind: 'clarify' };
  if (latestBudget.hasBudget && latestBudget.price === undefined)
    return { kind: 'clarify' };
  // Clarify whether Max is a model or a price limit before searching.
  if (contextualBudget.ambiguousMax)
    return { kind: 'clarify', reason: 'max-budget' };

  const category = resolveCategory(text, categories);
  const priceLimit = latestBudget.price ?? contextualBudget.price;
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
    (priceLimit === undefined && contextualBudget.hasBudget)
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
