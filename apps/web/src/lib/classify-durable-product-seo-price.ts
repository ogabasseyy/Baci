import type { ProductSeoMoneyCandidate } from './get-product-seo-money-candidates';

const QUANTITY_UNIT =
  /^\s*(?:units?|photos?|songs?|files?|people|users?|models?|colou?rs?|options?|sizes?|picks?|years?|days?|hours?|cycles?|washes|uses|pixels?|nits?|mah|gb|tb|mb|hz|mp|watts?|volts?|amps?|lumens?|lit(?:er|re)s?|degrees?|celsius|fahrenheit|inch(?:es)?|cm|mm|kg|g|grams?|oz|lbs?|pounds?)\b/i;
const PIXEL_DIMENSION_PAIR = /^\s*(?:[×x]|by)\s*\d[\d,.]*\s*(?:pixels?|px)\b/i;
const LIFESPAN_QUANTITY_UNIT =
  /^\s+(?:[\p{L}-]+\s+){0,2}(?:hours?|cycles?|washes|uses)\b/iu;
const MODIFIED_COUNT_UNIT =
  /^\s+(?:[\p{L}-]+\s+){1,2}(?:models?|colou?rs?|options?|sizes?|picks?)\b/iu;
// These ISO spellings are also ordinary words, unlike unambiguous usd/ngn.
const LEXICAL_CURRENCY_CODES = new Set([
  'ALL',
  'TRY',
  'TOP',
  'CUP',
  'PEN',
  'GEL',
  'BAM',
  'MAD',
  'MOP',
  'BOB',
  'SOS',
]);
const NON_RETAIL_AMOUNT_LABEL =
  /^\s+(?:(?:gift[- ]card\s+)?bonus|cashback|cash\s+back|trade[- ]in\s+credit|store\s+credit|credit(?!\s+cards?\b)|rebate|reward|discount)\b/i;
const MAGNITUDE_SPECIFICATION_UNIT =
  /^\s+(?:display|screen|resolution|video|recording|camera|photos?|pixels?)\b/i;
const SHORT_RESOLUTION_CONTEXT =
  /\b(?:video|resolution|stream(?:ing)?|record(?:ing)?|shoot(?:ing)?|upscal\w*|frame\s+rate|fps)\b/i;

function retailRelation(text: string, start: number) {
  const clause =
    text
      .slice(Math.max(0, start - 200), start)
      .split(/[.!?;\n]/)
      .at(-1) ?? '';
  const cue =
    /\b(msrp(?:\s+(?:is|was|are|were))?|rrp(?:\s+(?:is|was|are|were))?|prices?(?:\s+(?:is|from))?|costs?|priced\s+at|starts?\s+at|pay(?:\s+only)?|only|from|for|at)\s*[:–—-]?\s*(?:(?:just|only|about|around|approximately)\s+){0,2}$/i.exec(
      clause
    )?.[1] ?? '';
  const predicate =
    /\b(?:prices?|costs?)(?:\s+(?:in|of|for)\s+(?:(?!(?:and|or|but|whose|which|that|where)\b)[\p{L}\p{N}'-]+\s*){1,8})?\s*(?:\b(?:is|was|are|were)\b|:)\s*$/iu.test(
      clause
    );
  const copula = /\b(?:is|was|are|were)\s*$/i.test(clause);
  const identifierPredicate =
    /\b(?:model\s+(?:number|no\.?)|sku|part\s+(?:number|no\.?)|serial(?:\s+(?:number|no\.?))?|imei|item\s+(?:number|no\.?)|product\s+code)\s+(?:is|was|are|were|:)\s*$/i.test(
      clause
    );
  const commercial =
    /\b(?:sell(?:s|ing)?|sold|available|offered|retail(?:s|ed|ing)?)\b(?:\s+[^.!?;\n]{0,60})?\s+(?:at|for)\s*$/i.test(
      clause
    );
  return {
    cue,
    predicate,
    copula,
    identifierPredicate,
    commercial,
    separator: /^\s*[-:–—(]?\s*$/.test(clause),
    strong: /^(?:msrp|rrp|price|cost|priced|start|pay|only)/i.test(cue),
    purchase:
      /\b(?:buy|purchase)\b/i.test(clause) ||
      /\b(?:get(?!\s+(?:ready|prepared|started)\b)|shop)(?:\s+[^.!?;\n]{1,80})?\s+for\s*$/i.test(
        clause
      ),
  };
}

export function isDurableSeoPrice(
  candidate: ProductSeoMoneyCandidate,
  text: string
): boolean {
  const relation = retailRelation(text, candidate.start);
  const rawAmount = candidate.rawAmount.replace(/[.,]+$/, '');
  const tail = text.slice(candidate.end);
  const nearbyPrefix = text.slice(
    Math.max(0, candidate.start - 80),
    candidate.start
  );
  const lastCueIndex = (pattern: RegExp) =>
    [...nearbyPrefix.matchAll(pattern)].at(-1)?.index ?? -1;
  const physicalPounds =
    ['POUND', 'POUNDS'].includes(candidate.marker.toUpperCase()) &&
    lastCueIndex(
      /\b(?:weigh|weighs|weighing|weight|load(?:\s+capacity)?|payload(?:\s+capacity)?|capacity)\b/gi
    ) >
      lastCueIndex(
        /\b(?:cost|costs|price|prices|priced|buy|purchase|pay|sell)\b/gi
      );
  if (physicalPounds && !relation.cue && !relation.predicate) return false;
  const nearbyClause = nearbyPrefix.split(/[.!?;\n]/).at(-1) ?? '';
  const followingClause = tail.split(/[.!?;\n]/)[0] ?? '';
  const shortResolution =
    !candidate.marker &&
    /^\d{1,2}k$/i.test(rawAmount) &&
    SHORT_RESOLUTION_CONTEXT.test(`${nearbyClause} ${followingClause}`) &&
    !relation.strong &&
    !relation.predicate &&
    !relation.purchase &&
    !relation.commercial;
  if (shortResolution) return false;
  const parenthesizedProductYear =
    !candidate.marker &&
    /^(?:19|20)\d{2}$/.test(rawAmount) &&
    /^\s*\)\s*[.!?]?\s*$/.test(tail);
  if (parenthesizedProductYear) return false;
  const quantity =
    QUANTITY_UNIT.test(tail) ||
    PIXEL_DIMENSION_PAIR.test(tail) ||
    (LIFESPAN_QUANTITY_UNIT.test(tail) &&
      !/^\s+per\s+(?:hours?|cycles?|washes|uses)\b/i.test(tail)) ||
    (/^\d{1,2}$/.test(rawAmount) && MODIFIED_COUNT_UNIT.test(tail));
  if (candidate.fallbackIsoCode) {
    if (quantity) return false;
    if (
      !relation.cue &&
      !relation.predicate &&
      !relation.strong &&
      !relation.commercial
    )
      return false;
  }
  if (!candidate.marker) {
    if (relation.identifierPredicate && !relation.predicate) return false;
    if (
      (!relation.cue &&
        !relation.predicate &&
        !relation.separator &&
        !relation.copula) ||
      quantity
    )
      return false;
    if (
      /[km]$/i.test(candidate.rawAmount) &&
      MAGNITUDE_SPECIFICATION_UNIT.test(tail)
    )
      return false;
    return (
      relation.predicate ||
      relation.strong ||
      relation.purchase ||
      relation.commercial ||
      (relation.separator &&
        rawAmount.replace(/\D/g, '').length >= 3 &&
        (/^\s*$/.test(tail) || /^\s*\)\s*[.!?]?\s*$/.test(tail))) ||
      (relation.copula &&
        (/^\d{1,3}(?:[,. '\u2019\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/.test(
          rawAmount
        ) ||
          rawAmount.replace(/\D/g, '').length >= 5)) ||
      /[,km]/i.test(rawAmount) ||
      rawAmount.replace(/\D/g, '').length >= 5
    );
  }
  if (
    candidate.marker.toUpperCase() === 'SAR' &&
    /^\s*W\s*\/\s*kg\b/i.test(tail)
  )
    return false;
  // CAD software-release years are not Canadian-dollar amounts.
  if (
    candidate.marker.toUpperCase() === 'CAD' &&
    /^(?:19|20)\d{2}$/.test(rawAmount) &&
    /^\s+(?:software|version|design)\b/i.test(tail)
  )
    return false;
  // Casing alone does not disambiguate ordinary words from ISO homonyms.
  if (LEXICAL_CURRENCY_CODES.has(candidate.marker.toUpperCase())) {
    const isIsoCode = candidate.currencies.includes(
      candidate.marker.toUpperCase()
    );
    if (
      isIsoCode &&
      !relation.strong &&
      !relation.predicate &&
      !(candidate.marker === candidate.marker.toUpperCase() && !quantity) &&
      !(relation.purchase && relation.cue === 'for' && !quantity)
    )
      return false;
  }
  // AMD is both a currency and a hardware brand; the following noun disambiguates.
  if (
    candidate.marker.toUpperCase() === 'AMD' &&
    !relation.cue &&
    !relation.predicate &&
    (/^\s+(?:(?:XT|XTX|GRE|G|X|PRO)\s+)?(?:processors?|cpus?|gpus?|graphics)\b/i.test(
      tail
    ) ||
      /\bpowered\s+by\s*$/i.test(
        text.slice(Math.max(0, candidate.start - 30), candidate.start)
      ))
  )
    return false;
  // Compact single-letter aliases are also model prefixes. Spaced/explicit
  // foreign prices remain monetary; unqualified compact N/R16 stays a model.
  if (/^[nr]$/i.test(candidate.marker)) {
    if (
      !relation.cue &&
      !relation.predicate &&
      !/\s/.test(text.slice(candidate.start, candidate.end)) &&
      !/[,km]/i.test(rawAmount) &&
      rawAmount.replace(/\D/g, '').length < 5
    )
      return false;
  }
  return true;
}

export function isClearlyNonRetailSeoAmount(
  candidate: ProductSeoMoneyCandidate,
  text: string
): boolean {
  const relation = retailRelation(text, candidate.start);
  return (
    !relation.strong &&
    !relation.predicate &&
    !relation.purchase &&
    !relation.commercial &&
    NON_RETAIL_AMOUNT_LABEL.test(text.slice(candidate.end))
  );
}

export function isDurableSeoDenomination(
  candidate: ProductSeoMoneyCandidate,
  text: string,
  productName: string,
  denominations: ProductSeoMoneyCandidate[]
): boolean {
  if (
    !candidate.marker ||
    retailRelation(text, candidate.start).cue ||
    retailRelation(text, candidate.start).predicate
  )
    return false;
  if (
    !denominations.some(
      (value) =>
        (value.amount !== null && candidate.amount !== null
          ? value.amount === candidate.amount
          : value.amount === null &&
            candidate.amount === null &&
            value.rawAmount.replace(/[.,]+$/, '').toLowerCase() ===
              candidate.rawAmount.replace(/[.,]+$/, '').toLowerCase()) &&
        value.currencies.some((code) => candidate.currencies.includes(code))
    )
  )
    return false;
  const followingLabel =
    /^\s+((?:[\p{L}][\p{L}\p{N}'-]{0,30}\s+){0,4})(?:gift[- ]card|value|credit|denomination)\b/iu.exec(
      text.slice(candidate.end)
    );
  const precedingLabel = /\b(?:gift[- ]cards?|voucher|denomination)\b/i.test(
    text
      .slice(Math.max(0, candidate.start - 120), candidate.start)
      .split(/[.!?;\n]/)
      .at(-1) ?? ''
  );
  if (!followingLabel && !precedingLabel) return false;
  const identityWords = new Set(
    productName.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? []
  );
  if (followingLabel) {
    const matchesIdentity = followingLabel[1]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((word) => identityWords.has(word.toLowerCase()));
    if (matchesIdentity) return true;
  }
  if (precedingLabel) {
    const hasGiftCardIdentity =
      identityWords.has('gift') ||
      identityWords.has('card') ||
      identityWords.has('cards') ||
      identityWords.has('voucher');
    if (hasGiftCardIdentity) return true;
  }
  return false;
}
