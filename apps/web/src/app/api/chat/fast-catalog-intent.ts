import { isCatalogAcknowledgement } from './fast-catalog-alternative';
import { analyzeFastCatalogBudget } from './fast-catalog-budget';
import { resolveCatalogContext } from './fast-catalog-context';
import {
  createCompleteSearchVerifier,
  parseCatalogContinuation,
} from './fast-catalog-continuation';
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
        | 'ambiguous-budget'
        | 'more-results'
        | 'more-needs-search'
        | 'more-verify-category'
        | 'product-details'
        | 'product-type';
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
  /^(?:how much(?:\s+(?:is|for)\s+(?:it|that|this))?|what(?:['’]s| is)\s+(?:the\s+)?(?:price|cost)(?:\s+(?:(?:of|for)\s+)?(?:it|that|this))?|(?:what|how)\s+about\s+(?:the\s+)?(?:price|cost)|(?:the\s+)?(?:price|cost))[?!.\s]*$/i;
const SHOPPING_REQUEST =
  /\b(?:recommend|recommendation|suggest|looking for|buy|shop|do\s+you\s+(?:(?:currently|still)\s+)?(?:have|sell|carry|stock)|have\s+you\s+got|price|cost|how much|phone|phones|smartphone|smartphones|iphones?|pixel|laptop|laptops|macbook|tablet|tablets|ipad|galaxy\s+(?:[samf]\s*\d+|z\s*(?:fold|flip)\s*\d+))\b/i;
const FOLLOW_UP =
  /\b(?:under|below|budget|within|up\s+to|at\s+most|maximum|max|cheaper|cheapest|less|more|instead|wifi|wi-fi|used|new|gaming|camera|battery)\b/i;
const { PHONE_SIGNAL, LAPTOP_SIGNAL, TABLET_SIGNAL, ACCESSORY_SIGNAL } =
  catalogLanguage;
function searchText(text: string): string {
  const catalogText = catalogLanguage.stripCatalogAvailabilityPhrases(
    analyzeFastCatalogBudget(text).searchText
  );
  return catalogLanguage
    .normalizeAccessoryNouns(
      catalogLanguage.stripRelativePricePhrases(
        catalogLanguage.normalizeUseCasePhrases(catalogText)
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
  currencyCode?: string,
  options: { categoriesLoaded?: boolean } = {}
): FastCatalogIntent | null {
  const latest = userMessages.at(-1)?.trim() ?? '';
  const typeOnly = (text: string) =>
    catalogLanguage.isShortProductType(
      analyzeFastCatalogBudget(text, currencyCode).searchText
    );
  const budgetOnly = (text: string) =>
    !catalogLanguage.hasCatalogProductCue(text) &&
    !/\b(?:instead|rather\s+than|switch|change|swap)\b/i.test(text) &&
    analyzeFastCatalogBudget(text, currencyCode).hasBudget &&
    !searchText(text);
  const previous = typeOnly(latest)
    ? [...userMessages.slice(-50, -1)].reverse().find((message) => {
        const text = message.trim();
        return (
          !text ||
          catalogLanguage.isCatalogBoundary(text) ||
          (!typeOnly(text) &&
            !budgetOnly(text) &&
            !CONTEXTUAL_PRICE.test(text) &&
            !catalogLanguage.isAvailabilityFollowUp(text) &&
            !isCatalogAcknowledgement(text))
        );
      })
    : undefined;
  if (
    previous &&
    catalogLanguage.hasCompoundPlusModel(previous) &&
    !catalogLanguage.isCatalogBoundary(previous) &&
    !catalogLanguage.resolveCatalogCategory(previous, categories)
  )
    return { kind: 'clarify', reason: 'product-type' };
  const verifier = createCompleteSearchVerifier({
    categoriesLoaded: options.categoriesLoaded !== false,
    currencyCode,
    isSearch: (value) => {
      const intent = interpretFastCatalogIntent(
        [value],
        categories,
        currencyCode
      );
      return (
        intent?.kind === 'search' &&
        intent.maxPrice !== undefined &&
        !!intent.categoryId
      );
    },
  });
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
    isCompleteSearch: verifier.isCompleteSearch,
    getContinuationRequest: parseCatalogContinuation,
  });
  if (!context) return null;
  const continuation = parseCatalogContinuation(latest);
  if (verifier.needsCategoryVerification())
    return { kind: 'clarify', reason: 'more-verify-category' };
  if (context.requiresFreshSearch)
    return { kind: 'clarify', reason: 'more-needs-search' };
  if (continuation?.kind === 'product-details')
    return { kind: 'clarify', reason: 'product-details' };
  const { text, priceFollowUp } = context;
  const { wifiOnly, otherNegation } = catalogLanguage.resolveWifiOnly(text);
  if (
    otherNegation ||
    catalogLanguage.hasUnsupportedStockRequest(text) ||
    catalogLanguage.hasUnsupportedDisjunction(text) ||
    catalogLanguage.hasAmbiguousProductBundle(text)
  )
    return { kind: 'clarify', reason: 'options' };
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
  if (
    /\bmore\s+(?:storage|ram|memory|capacity|like|expensive|costly)\b/i.test(
      text
    )
  )
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
  if (contextualBudget.ambiguousMax)
    return { kind: 'clarify', reason: 'max-budget' };
  if (continuation?.kind === 'more-results')
    return { kind: 'clarify', reason: 'more-results' };
  const category = catalogLanguage.resolveCatalogCategory(text, categories);
  if (
    options.categoriesLoaded !== false &&
    !category &&
    catalogLanguage.hasCompoundPlusModel(text)
  )
    return { kind: 'clarify', reason: 'product-type' };
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
