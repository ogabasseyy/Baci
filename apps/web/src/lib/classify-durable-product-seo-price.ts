import { retailRelation } from './classify-durable-product-seo-retail-relation';
import type { ProductSeoMoneyCandidate } from './get-product-seo-money-candidates';
import { isNonMonetarySeoAmountContext } from './is-non-monetary-seo-amount-context';

const QUANTITY_UNIT =
  /^\s*[-‑]?\s*(?:units?|items?|pieces?|photos?|songs?|files?|people|users?|models?|colou?rs?|options?|sizes?|picks?|years?|months?|mos?|weeks?|wks?|days?|hours?|minutes?|mins?|seconds?|secs?|cycles?|washes|uses|pixels?|nits?|mah|kwh|wh|mwh|gb|tb|mb|hz|khz|mhz|ghz|mp|watts?|volts?|amps?|lumens?|lit(?:er|re)s?|ml|millilit(?:er|re)s?|met(?:er|re)s?|m|degrees?|celsius|fahrenheit|inch(?:es)?|cm|mm|kg|g|grams?|oz|lbs?|pounds?)\b/i;
const ATTACHED_METER_UNIT = /^\d+m$/i;
const ATTACHED_METER_CONTEXT =
  /^\s*(?:long|length|tall|height|wide|width|deep|depth|distance|cable|cord|wire|hose|drop|lead)\b/i;
const STOCK_COUNT_CONTEXT =
  /^\s*(?:(?:items?|pieces?|units?|copies)\s+)?(?:left(?:\s+in\s+stock)?|in\s+stock|remaining)\b/i;
const PERCENTAGE_QUANTITY = /^\s*%/;
const PIXEL_DIMENSION_PAIR =
  /^\s*(?:[×x]|by)\s*\d[\d,.]*\s*(?:pixels?|px|display|screen|resolution)\b/i;
const UNITLESS_PIXEL_DIMENSION_PAIR =
  /^\s*(?:[×x]|by)\s*(\d[\d,.]*)\s*[.,;)!?]?\s*$/i;
const UNLABELLED_PRICE_RANGE =
  /^\s*[–—-]?\s*((?:[0-9٠-٩۰-۹]{3,}|[0-9٠-٩۰-۹]{1,3}(?:[,٬][0-9٠-٩۰-۹]{3})+))\s*[–—-]\s*((?:[0-9٠-٩۰-۹]{3,}|[0-9٠-٩۰-۹]{1,3}(?:[,٬][0-9٠-٩۰-۹]{3})+))\s*[.!?]?\s*$/;
const FORM_FACTOR_SPECIFICATION = /^\s*[-‑]?\s*in\s*[-‑]?\s*[0-9٠-٩۰-۹]+\b/i;
const LIFESPAN_QUANTITY_UNIT =
  /^\s+(?:(?!(?:on|for|in|at|across|with|from|to|by|per|each|every|an?|the|and|or|plus|including|warranty|guarantee|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b)[\p{L}-]+\s+){0,2}(?:years?|months?|mos?|weeks?|wks?|days?|hours?|minutes?|mins?|seconds?|secs?|cycles?|washes|uses)\b/iu;
const PER_DURATION_UNIT =
  /^\s*(?:\/|\b(?:per|each|every|an?)\b\s+)(?:years?|months?|mos?|weeks?|wks?|days?|hours?|minutes?|mins?|seconds?|secs?|cycles?|washes|uses)\b/i;
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
const MAGNITUDE_SPECIFICATION_UNIT =
  /^\s+(?:display|screen|resolution|video|recording|camera|photos?|pixels?)\b/i;
const STANDARD_DISPLAY_RESOLUTION_RANGES = new Set([
  '1024x768',
  '1280x720',
  '1280x800',
  '1280x1024',
  '1366x768',
  '1440x900',
  '1600x900',
  '1600x1200',
  '1680x1050',
  '1920x1080',
  '1920x1200',
  '2560x1080',
  '2560x1440',
  '2560x1600',
  '2880x1800',
  '3440x1440',
  '3840x2160',
  '4096x2160',
  '5120x1440',
  '5120x2880',
  '7680x4320',
]);

const FOLLOWING_PRICE_PREDICATE =
  /^\s+(?:is|was|are|were)\s+(?:now\s+)?(?:the\s+)?(?:(?:current|retail|sale|offer|asking|list|starting|regular|original)\s+)?(?:price|cost|msrp|rrp)\b/i;

const SEPARATOR_PRICE_TAIL =
  /^\s*(?:\)\s*)?[.!?]{0,3}(?:\s*(?:[|•·]\s*[^.,;!?]+|[-\u2013\u2014]\s*[A-Za-z][^.,;!?]*))?[.!?]{0,3}\s*$/;

function normalizeLocalizedDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - '٠'.charCodeAt(0))
    )
    .replace(/[۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - '۰'.charCodeAt(0))
    );
}

export function isDurableSeoPrice(
  candidate: ProductSeoMoneyCandidate,
  text: string
): boolean {
  const relation = retailRelation(text, candidate.start);
  if (isNonMonetarySeoAmountContext(candidate, text, relation)) {
    return false;
  }
  const rawAmount = candidate.rawAmount.replace(/[.,]+$/, '');
  const rawAmountDigitCount = rawAmount.match(/[0-9٠-٩۰-۹]/g)?.length ?? 0;
  const tail = text.slice(candidate.end);
  const nearbyPrefix = text.slice(
    Math.max(0, candidate.start - 80),
    candidate.start
  );
  const nearbyClause = nearbyPrefix.split(/[.!?;\n]/).at(-1) ?? '';
  const unitlessDimension = UNITLESS_PIXEL_DIMENSION_PAIR.exec(tail);
  const unitlessDimensionValue = unitlessDimension?.[1]
    ? Number(unitlessDimension[1].replace(/,/g, ''))
    : 0;
  const hasExplicitRetailContext =
    relation.strong ||
    relation.predicate ||
    relation.purchase ||
    relation.commercial;
  const hasUnitlessPixelDimension =
    Boolean(unitlessDimension) &&
    !hasExplicitRetailContext &&
    (unitlessDimensionValue >= 320 ||
      /\b(?:display|screen|resolution)\b/i.test(nearbyClause));

  const quantity =
    QUANTITY_UNIT.test(tail) ||
    (ATTACHED_METER_UNIT.test(rawAmount) &&
      ATTACHED_METER_CONTEXT.test(tail)) ||
    PERCENTAGE_QUANTITY.test(tail) ||
    FORM_FACTOR_SPECIFICATION.test(tail) ||
    PIXEL_DIMENSION_PAIR.test(tail) ||
    hasUnitlessPixelDimension ||
    (/\d[\d,.]*\s*(?:[×x]|by)\s*$/i.test(nearbyPrefix) &&
      /^\s*(?:pixels?|px|display|screen|resolution)\b/i.test(tail)) ||
    STOCK_COUNT_CONTEXT.test(tail) ||
    (LIFESPAN_QUANTITY_UNIT.test(tail) && !PER_DURATION_UNIT.test(tail)) ||
    (/^\d{1,2}$/.test(rawAmount) && MODIFIED_COUNT_UNIT.test(tail));

  const unlabelledRange = UNLABELLED_PRICE_RANGE.exec(text);
  const normalizedRange = unlabelledRange
    ?.slice(1)
    .map((value) => normalizeLocalizedDigits(value).replace(/[,٬]/g, ''));
  const isProductYearRange = normalizedRange?.every((value) =>
    /^(?:19|20)\d{2}$/.test(value)
  );
  const rangeValues = normalizedRange?.map(Number);
  const [firstRangeValue = 0, secondRangeValue = 0] = rangeValues ?? [];
  const rangeMin = Math.min(firstRangeValue, secondRangeValue);
  const rangeMax = Math.max(firstRangeValue, secondRangeValue);
  const aspectRatio = rangeMax / rangeMin;
  const isResolutionRange =
    rangeValues?.length === 2 &&
    (STANDARD_DISPLAY_RESOLUTION_RANGES.has(`${rangeMax}x${rangeMin}`) ||
      (firstRangeValue > secondRangeValue &&
        rangeMax >= 2000 &&
        rangeMin >= 720 &&
        aspectRatio >= 1.3 &&
        aspectRatio <= 2.5));

  if (
    !candidate.marker &&
    !quantity &&
    !isProductYearRange &&
    !isResolutionRange &&
    unlabelledRange
  )
    return true;

  const followingPricePredicate = FOLLOWING_PRICE_PREDICATE.test(tail);

  if (candidate.fallbackIsoCode) {
    if (quantity) return false;
    if (
      !relation.cue &&
      !relation.predicate &&
      !relation.strong &&
      !relation.commercial &&
      !followingPricePredicate
    )
      return false;
  }

  if (!candidate.marker) {
    if (
      relation.identifierPredicate &&
      !relation.predicate &&
      !relation.cue &&
      !relation.strong &&
      !relation.commercial &&
      !relation.purchase &&
      !followingPricePredicate
    )
      return false;
    if (
      (!relation.cue &&
        !relation.predicate &&
        !relation.separator &&
        !relation.copula &&
        !followingPricePredicate) ||
      quantity
    )
      return false;
    if (
      /[km]$/i.test(candidate.rawAmount) &&
      MAGNITUDE_SPECIFICATION_UNIT.test(tail)
    )
      return false;
    return (
      followingPricePredicate ||
      relation.predicate ||
      relation.strong ||
      relation.purchase ||
      relation.commercial ||
      (relation.separator &&
        rawAmountDigitCount >= 3 &&
        SEPARATOR_PRICE_TAIL.test(tail)) ||
      (relation.copula &&
        (/^\d{1,3}(?:[,. '\u2019\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/.test(
          rawAmount
        ) ||
          rawAmountDigitCount >= 5)) ||
      /[,km]/i.test(rawAmount) ||
      rawAmountDigitCount >= 5
    );
  }

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

  // Compact single-letter aliases are also model prefixes. Spaced/explicit
  // foreign prices remain monetary; unqualified compact N/R16 stays a model.
  if (/^[nr]$/i.test(candidate.marker)) {
    if (
      (!relation.cue || relation.cue === 'heading') &&
      !relation.predicate &&
      !/\s/.test(text.slice(candidate.start, candidate.end)) &&
      !/[,km]/i.test(rawAmount) &&
      rawAmountDigitCount < 5
    )
      return false;
  }

  return true;
}
