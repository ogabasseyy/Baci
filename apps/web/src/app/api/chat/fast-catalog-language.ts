export const actionRequest =
  /\b(?:order|orders|payment|payments|paid|pay|transfer|cancel|refund|receipt|delivery|deliver|shipping|track|tracking|cart|checkout|support|buy\s+(?:it|that|this))\b/i;
export const nonCatalogRequest =
  /\b(?:negotiat\w*|discount\w*|haggl\w*|(?:last|final)\s+price|(?:reduce|lower)\s+(?:the\s+|your\s+)?(?:price|cost)|bargain|deal|warrant(?:y|ies)|instal{1,2}ments?|returns?|refund\w*|polic(?:y|ies)|contact|address|location|(?:sell|trade|swap)\s+(?:my|this|that)|carry\b[^?]{0,80}\b(?:airport|airplane|plane|flight))\b/i;

// These conditions require evidence beyond the catalog's recommendation tags.
export const uncheckedOption =
  /\b(?:brand[\s-]*new|new|used|refurbished|second[\s-]*hand|pre[\s-]*owned|open[\s-]*box|\d+(?:\.\d+)?\s*(?:gb|tb)|\d+(?:[.,]\d+)?[\s-]*(?:m\s*a\s*h|mp|megapixels?)|black|blue|red|green|purple|pink|white|gold|silver|gray|grey|titanium|e-?sim|physical\s+sim|dual[\s-]*sim|low[\s-]*light|all[\s-]*day\s+battery|\d+\s*(?:hours?|hrs?|days?)\s+(?:of\s+)?battery|battery\s+(?:that\s+)?(?:lasts?|lasting)\s+(?:for\s+)?(?:all[\s-]*day|\d+\s*(?:hours?|days?)))\b/i;

export const PHONE_SIGNAL =
  /\b(?:smartphones?|phones?|iphones?|pixel|galaxy\s+(?:[samf]\s*\d+|z\s*(?:fold|flip)\s*\d+))\b/i;
export const LAPTOP_SIGNAL = /\b(?:laptops?|macbook|notebook)\b/i;
export const TABLET_SIGNAL = /\b(?:tablets?|ipad)\b/i;
export const ACCESSORY_SIGNAL =
  /\b(?:airpods|earbuds?|headphones?|headsets?|earphones?|chargers?|cables?|adapters?|power[\s-]*banks?|cases?|screen[\s-]*protectors?|speakers?)\b/i;

export function normalizeAccessoryNouns(value: string): string {
  return value.replace(
    /\b(?:chargers|cables|adapters|cases|headphones|headsets|earphones|earbuds|speakers|banks|protectors)\b/gi,
    (word) => word.slice(0, -1)
  );
}

export function resolveCatalogCategory<T extends { slug: string }>(
  text: string,
  categories: T[]
): T | undefined {
  if (ACCESSORY_SIGNAL.test(text)) {
    if (/\bearbuds?\b/i.test(text))
      return categories.find(
        (candidate) => candidate.slug.toLowerCase() === 'earbuds'
      );
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

export function isShortProductType(text: string): boolean {
  return /^(?:(?:yes|yeah|please|pls),? ){0,2}(?:it(?:['’]s| is) )?(?:(?:an?|the) )?(?:phones?|smartphones?|accessor(?:y|ies)|chargers?|cases?|earbuds?)(?:,? (?:please|pls|thanks|thank you))?[?!. ]*$/i.test(
    text.replace(/\s+/g, ' ').trim()
  );
}

export function isAvailabilityFollowUp(text: string): boolean {
  return /^(?:(?:is|are) (?:it|this|that|they|these|those) )?(?:(?:currently|still) )?(?:in[ -]+stock|available)(?: (?:now|right now))?[?!. ]*$/i.test(
    text.replace(/\s+/g, ' ').trim()
  );
}

export function hasCatalogProductCue(text: string): boolean {
  return [PHONE_SIGNAL, LAPTOP_SIGNAL, TABLET_SIGNAL, ACCESSORY_SIGNAL].some(
    (signal) => signal.test(text)
  );
}

export function isBusinessFactRequest(text: string): boolean {
  return /\b(?:address|location|located|opening\s+(?:time|hours)|closing\s+(?:time|hours)|(?:business|store|shop)\s+hours|when\s+do\s+you\s+(?:open|close)|(?:phone|whatsapp)\s+(?:number|no)|telephone(?:\s+(?:number|no))?|(?:your|our|(?:store|shop|business|ogabassey)(?:['’]s)?)\s+(?:(?:phone|telephone|whatsapp)\s+)?(?:number|no)|email(?:\s+address)?|contact\s+(?:you|us|support|(?:the\s+)?(?:store|shop)|ogabassey|number|details|information|info)|(?:how\s+(?:can|do)\s+i|can\s+i)\s+(?:call|reach)\s+(?:you|(?:the\s+)?(?:store|shop)|ogabassey))\b/i.test(
    text
  );
}

export function isCatalogBoundary(text: string): boolean {
  const purchase =
    /\border\s+(?:me\s+)?(?:an?\s+)?(?:iphones?|smartphones?|phones?|laptops?|tablets?|chargers?|earbuds?|cases?)\b/i.test(
      text
    );
  const actionText = purchase ? text.replace(/\border\b/i, 'buy') : text;
  return (
    actionRequest.test(actionText) ||
    nonCatalogRequest.test(text) ||
    isBusinessFactRequest(text)
  );
}

export function hasNegatedBudget(text: string): boolean {
  return /\b(?:not|no|never|without|avoid|don['’]?t)\s+(?:under|below|within|less\s+than|up\s+to|at\s+most|maximum|max)(?=\b|[₦\d])/i.test(
    text
  );
}

/** Disjunctions and explicit substitutions need option-aware interpretation. */
export function hasUnsupportedDisjunction(text: string): boolean {
  return /\b(?:or|versus|vs|instead|rather\s+than|other\s+than)\b/i.test(text);
}

/** Only the current, purchasable catalog is available to this search. */
export function hasUnsupportedStockRequest(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ');
  if (
    /\b(?:out[ -]+of[ -]+stock|sold[ -]+out|back[ -]+in[ -]+stock|restock(?:ed|ing)?)\b/i.test(
      normalized
    )
  )
    return true;
  return (
    /\bin[ -]+stock\b/i.test(normalized) &&
    (/\b(?:how many|number of|when|will|was|were|isn['’]t|aren['’]t)\b/i.test(
      normalized
    ) ||
      /\bin[ -]+stock (?:in|at(?! most\b))\b/i.test(normalized))
  );
}

/** Remove availability grammar while preserving literal product terms. */
export function stripCatalogAvailabilityPhrases(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\bdo you (?:(?:currently|still) )?stock\b/gi, ' ')
    .replace(
      /\b(?:currently |still )?in[ -]+stock(?: (?:currently|right now|now))?\b/gi,
      ' '
    )
    .replace(
      /\b(iphones?|smartphones?|phones?|laptops?|tablets?|ipads?) models\b/gi,
      '$1'
    );
}

export function normalizeCatalogModelPunctuation(text: string): string {
  return text.normalize('NFKC').replace(/[\p{Dash_Punctuation}\u2212]/gu, '-');
}

export function hasCompoundPlusModel(text: string): boolean {
  return /\b[a-z0-9]{0,11}\d[a-z0-9]{0,4}(?:[ -]{1,16}(?:pro|max|ultra)){1,2}(?:\+|[ -]{1,16}plus\b)/i.test(
    normalizeCatalogModelPunctuation(text).replace(/\s+/g, ' ')
  );
}

/** Ambiguous model additions and device/accessory bundles need clarification. */
export function hasAmbiguousProductBundle(text: string): boolean {
  const normalized = normalizeCatalogModelPunctuation(text).replace(
    /\s+/g,
    ' '
  );
  if (
    /\b[a-z0-9]{0,11}\d[a-z0-9]{0,4}(?:[ -]{1,16}(?:pro|max|ultra)){0,2}(?:\s+\+|\+(?![345]g\b)(?=[a-z0-9]))/i.test(
      normalized
    )
  )
    return true;
  let seenDevice = false;
  let seenAccessory = false;
  const separated = normalized
    .replace(/\bbuds[ -]+plus\b/gi, 'budsplus')
    .replace(
      /\bin (?=[^,;.!?]{0,80}\b(?:cases?|covers?|chargers?)\b)/gi,
      'with '
    )
    .replace(
      /\b(phones?|smartphones?|iphones?|laptops?|notebooks?|macbooks?|tablets?|ipads?|airpods|earbuds?|headphones?|headsets?|earphones?|chargers?|cables?|adapters?|power[\s-]*banks?|cases?|screen[\s-]*protectors?|speakers?)\s*\+/gi,
      '$1 + '
    );
  for (const part of separated.split(/\b(?:and|with|plus)\b|\s\+\s|[&,]/i)) {
    const device =
      [PHONE_SIGNAL, LAPTOP_SIGNAL, TABLET_SIGNAL].some((signal) =>
        signal.test(part)
      ) ||
      /\b(?:buds(?:plus)?|earbuds?|airpods|headphones?|headsets?|earphones?)\b/i.test(
        part
      );
    const accessory = ACCESSORY_SIGNAL.test(part);
    if ((device && seenAccessory) || (accessory && seenDevice)) return true;
    seenDevice ||= device;
    seenAccessory ||= accessory;
  }
  return false;
}

export function isRelativePriceRequest(text: string): boolean {
  return /\b(?:cheaper|cheapest|less\s+expensive|more\s+affordable)\b/i.test(
    text
  );
}

export function stripRelativePricePhrases(text: string): string {
  return text.replace(
    /\b(?:(?:anything|something|any)\s+)?(?:cheaper|cheapest|less\s+expensive|more\s+affordable)(?:\s+(?:options?|models?|products?|ones?))?\b/gi,
    ' '
  );
}

export function resolveWifiOnly(text: string): {
  wifiOnly: boolean;
  otherNegation: boolean;
} {
  const directive =
    /(?:\b(?:not|no|without|avoid|exclude|except|never|don['’]?t)\s+(?:an?\s+)?)?\bwi[\s-]*fi[\s-]*only\b/gi;
  const last = [...text.matchAll(directive)].at(-1)?.[0] ?? '';
  return {
    wifiOnly:
      Boolean(last) &&
      !/^(?:not|no|without|avoid|exclude|except|never|don['’]?t)\b/i.test(last),
    otherNegation:
      /\b(?:not|no|without|avoid|exclude|except|never|don['’]?t)\b/i.test(
        text.replace(directive, ' ')
      ),
  };
}

/** Strip only recognized recommendation phrases; keep model and option terms. */
export function normalizeUseCasePhrases(text: string): string {
  return text
    .replace(
      /\b(?:long(?:[\s-]+lasting)?|longer|good|great|better|best|excellent)\s+battery(?:\s+life)?\b(?!\s+(?:chargers?|cases?)\b)/gi,
      'battery'
    )
    .replace(/\bbattery\s+life\b/gi, 'battery')
    .replace(
      /\b(?:(?:good|great|better|best|excellent)\s+)?camera\s+quality\b/gi,
      'camera'
    )
    .replace(/\b(?:heavy|hardcore|mobile|casual)\s+gaming\b/gi, 'gaming');
}

/** A battery charger or case is a product name, not a recommendation tag. */
export function catalogPreferenceText(text: string): string {
  return text.replace(/\bbattery(?=\s+(?:chargers?|cases?)\b)/gi, ' ');
}
