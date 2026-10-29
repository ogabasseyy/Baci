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

const ACTION_REQUEST =
  /\b(?:order|orders|payment|payments|paid|pay|transfer|cancel|refund|receipt|delivery|deliver|shipping|track|tracking|cart|checkout|support|buy\s+(?:it|that|this))\b/i;
const NON_CATALOG_REQUEST =
  /\b(?:negotiat\w*|discount\w*|haggl\w*|(?:last|final)\s+price|(?:reduce|lower)\s+(?:the\s+|your\s+)?(?:price|cost)|bargain|deal|warrant(?:y|ies)|instal{1,2}ments?|returns?|refund\w*|polic(?:y|ies)|contact|address|location|(?:sell|trade|swap)\s+(?:my|this|that)|carry\b[^?]{0,80}\b(?:airport|airplane|plane|flight))\b/i;
const CONTEXTUAL_PRICE =
  /^(?:how much(?:\s+(?:is|for)\s+(?:it|that|this))?|what(?:['’]s| is)\s+(?:the\s+)?(?:price|cost)(?:\s+(?:(?:of|for)\s+)?(?:it|that|this))?|(?:the\s+)?(?:price|cost))[?!.\s]*$/i;
const SHOPPING_REQUEST =
  /\b(?:recommend|recommendation|suggest|looking for|buy|shop|do\s+you\s+(?:have|sell|carry|stock)|have\s+you\s+got|price|cost|how much|phone|phones|smartphone|smartphones|iphones?|pixel|laptop|laptops|macbook|tablet|tablets|ipad|galaxy\s+(?:[samf]\s*\d+|z\s*(?:fold|flip)\s*\d+))\b/i;
const FOLLOW_UP =
  /\b(?:under|below|budget|cheaper|less|more|instead|wifi|wi-fi|used|new)\b/i;
const BUDGET_WORD =
  /\b(?:under|below|budget|within|less than|up to|at most|maximum|max|between)\b/i;
const MAX_PRICE =
  /\b(?:under|below|budget(?:\s+of)?|within|less than|up to|at most|maximum|max)\s*(?:₦|ngn\s*|n(?=\d))?\s*([\d,]+(?:\.\d+)?)\s*(million|thousand|[km])?\b/i;
// Do not silently drop option requirements that need variant-level selection.
const UNCHECKED_OPTION =
  /\b(?:brand[\s-]*new|new|used|refurbished|second[\s-]*hand|pre[\s-]*owned|open[\s-]*box|\d+(?:\.\d+)?\s*(?:gb|tb)|black|blue|red|green|purple|pink|white|gold|silver|gray|grey|titanium|e-?sim|physical\s+sim|dual[\s-]*sim)\b/i;
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
  const match = [...text.matchAll(new RegExp(MAX_PRICE.source, 'gi'))].find(
    (candidate) => isBudgetMatch(text, candidate[0], candidate.index)
  );
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
  return normalizeAccessoryNouns(text)
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
      /\b(?:show|me|find|please|recommend|recommendation|suggest|looking|for|buy|order|shop|sell|carry|best|good|great|cheap|affordable|gaming|camera|battery|with|under|smartphones?|phones?|laptops?|tablets?|a|an|the|my|what|which|is|am|are|available|can|i|need|want|get|got|do|does|you|have|of|and|how|much|price|cost|any|in|store|to|it|that|this)\b/gi,
      ' '
    )
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
  const orderAsPurchase =
    /\border\s+(?:me\s+)?(?:an?\s+)?(?:iphones?|smartphones?|phones?|laptops?|tablets?|chargers?|earbuds?|cases?)\b/i.test(
      latest
    );
  const actionText = orderAsPurchase
    ? latest.replace(/\border\b/i, 'buy')
    : latest;
  if (
    !latest ||
    ACTION_REQUEST.test(actionText) ||
    NON_CATALOG_REQUEST.test(latest)
  )
    return null;

  const previous = userMessages.at(-2) ?? '';
  const isShoppingRequest = (value: string) =>
    SHOPPING_REQUEST.test(value) || ACCESSORY_SIGNAL.test(value);
  const priceFollowUp = CONTEXTUAL_PRICE.test(latest);
  if (priceFollowUp && !isShoppingRequest(previous)) return null;
  const text = priceFollowUp
    ? previous
    : FOLLOW_UP.test(latest) &&
        !isShoppingRequest(latest) &&
        isShoppingRequest(previous)
      ? `${previous} ${latest}`
      : latest;
  if (!isShoppingRequest(text)) return null;
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
    (text.match(/\b(?:gaming|camera|battery)\b/gi) ?? []).map((value) =>
      value.toLowerCase()
    )
  );
  if (
    UNCHECKED_OPTION.test(text) ||
    preferences.size > 1 ||
    (preferences.size > 0 &&
      /\b(?:not|no|without|avoid|exclude|except|never|don'?t)\b/i.test(text))
  )
    return { kind: 'clarify', reason: 'options' };
  const wifiOnlyMentioned = /\bwi[\s-]*fi[\s-]*only\b/i.test(text);
  const wifiOnlyNegated =
    /\b(?:not|no|without|avoid|exclude|except|never|don'?t)\s+(?:an?\s+)?wi[\s-]*fi[\s-]*only\b/i.test(
      text
    );
  if (
    wifiOnlyMentioned &&
    !wifiOnlyNegated &&
    /\b(?:not|no|without|avoid|exclude|except|never|don'?t)\b/i.test(text)
  ) {
    return { kind: 'clarify', reason: 'options' };
  }
  const wifiOnly = wifiOnlyMentioned && !wifiOnlyNegated;
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
