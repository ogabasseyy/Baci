import { retailRelation } from './classify-durable-product-seo-retail-relation';
import type { ProductSeoMoneyCandidate } from './get-product-seo-money-candidates';

const QUANTITY_UNIT =
  /^\s*[-‑]?\s*(?:units?|items?|pieces?|photos?|songs?|files?|people|users?|models?|colou?rs?|options?|sizes?|picks?|years?|days?|hours?|cycles?|washes|uses|pixels?|nits?|mah|kwh|wh|mwh|gb|tb|mb|hz|khz|mhz|ghz|mp|watts?|volts?|amps?|lumens?|lit(?:er|re)s?|degrees?|celsius|fahrenheit|inch(?:es)?|cm|mm|kg|g|grams?|oz|lbs?|pounds?)\b/i;
const STOCK_COUNT_CONTEXT =
  /^\s*(?:(?:items?|pieces?|units?|copies)\s+)?(?:left(?:\s+in\s+stock)?|in\s+stock|remaining)\b/i;
const PERCENTAGE_QUANTITY = /^\s*%/;
const CLOCK_TIME_TAIL =
  /^(?:[:.]\d{2}\s*(?:am|pm|gmt|utc|est|pst|cst|bst|cet)\b|:\d{2}\b|\s*(?:am|pm)\b)/i;
const PIXEL_DIMENSION_PAIR =
  /^\s*(?:[×x]|by)\s*\d[\d,.]*\s*(?:pixels?|px|display|screen|resolution)\b/i;
const UNITLESS_PIXEL_DIMENSION_PAIR =
  /^\s*(?:[×x]|by)\s*(\d[\d,.]*)\s*[.,;)!?]?\s*$/i;
const UNLABELLED_PRICE_RANGE =
  /^\s*[–—-]?\s*((?:[0-9٠-٩۰-۹]{3,}|[0-9٠-٩۰-۹]{1,3}(?:[,٬][0-9٠-٩۰-۹]{3})+))\s*[–—-]\s*((?:[0-9٠-٩۰-۹]{3,}|[0-9٠-٩۰-۹]{1,3}(?:[,٬][0-9٠-٩۰-۹]{3})+))\s*[.!?]?\s*$/;
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
const MAGNITUDE_SPECIFICATION_UNIT =
  /^\s+(?:display|screen|resolution|video|recording|camera|photos?|pixels?)\b/i;
const SHORT_RESOLUTION_CONTEXT =
  /\b(?:video|resolution|stream(?:ing)?|record(?:ing)?|shoot(?:ing)?|upscal\w*|frame\s+rate|fps)\b/i;
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
  const rawAmount = candidate.rawAmount.replace(/[.,]+$/, '');
  const rawAmountDigitCount = rawAmount.match(/[0-9٠-٩۰-۹]/g)?.length ?? 0;
  const tail = text.slice(candidate.end);
  const nearbyPrefix = text.slice(
    Math.max(0, candidate.start - 80),
    candidate.start
  );
  const nearbyClause = nearbyPrefix.split(/[.!?;\n]/).at(-1) ?? '';
  const lastCueIndex = (pattern: RegExp) =>
    [...nearbyPrefix.matchAll(pattern)].at(-1)?.index ?? -1;
  const physicalPounds =
    ['POUND', 'POUNDS'].includes(candidate.marker.toUpperCase()) &&
    (lastCueIndex(
      /\b(?:weigh|weighs|weighing|weight|load(?:\s+capacity)?|payload(?:\s+capacity)?|capacity)\b/gi
    ) >
      lastCueIndex(
        /\b(?:cost|costs|price|prices|priced|buy|purchase|pay|sell)\b/gi
      ) ||
      (/^\s+of\b/i.test(text.slice(candidate.end)) &&
        /\b(?:contains?|containing|comprises?|holds?)\b/i.test(nearbyClause)));
  if (physicalPounds && !relation.cue && !relation.predicate) return false;
  const followingClause = tail.split(/[.!?;\n]/)[0] ?? '';
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
  const clockTime = !candidate.marker && CLOCK_TIME_TAIL.test(tail);
  if (clockTime) return false;
  const quantity =
    QUANTITY_UNIT.test(tail) ||
    PERCENTAGE_QUANTITY.test(tail) ||
    PIXEL_DIMENSION_PAIR.test(tail) ||
    hasUnitlessPixelDimension ||
    (/\d[\d,.]*\s*(?:[×x]|by)\s*$/i.test(nearbyPrefix) &&
      /^\s*(?:pixels?|px|display|screen|resolution)\b/i.test(tail)) ||
    STOCK_COUNT_CONTEXT.test(tail) ||
    (LIFESPAN_QUANTITY_UNIT.test(tail) &&
      !/^\s+per\s+(?:hours?|cycles?|washes|uses)\b/i.test(tail)) ||
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
    if (
      relation.identifierPredicate &&
      !relation.predicate &&
      !relation.cue &&
      !relation.strong &&
      !relation.commercial &&
      !relation.purchase
    )
      return false;
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
        rawAmountDigitCount >= 3 &&
        (/^\s*$/.test(tail) || /^\s*\)\s*[.!?]?\s*$/.test(tail))) ||
      (relation.copula &&
        (/^\d{1,3}(?:[,. '\u2019\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/.test(
          rawAmount
        ) ||
          rawAmountDigitCount >= 5)) ||
      /[,km]/i.test(rawAmount) ||
      rawAmountDigitCount >= 5
    );
  }
  if (
    candidate.marker.toUpperCase() === 'SAR' &&
    /^\s*W\s*\/\s*kg\b/i.test(tail)
  )
    return false;
  // PHP followed by a runtime/version clause is a software requirement, not currency.
  if (
    candidate.marker.toUpperCase() === 'PHP' &&
    /^\s+(?:and\s+)?(?:MySQL|runtime|version)\b/i.test(tail) &&
    !relation.cue &&
    !relation.strong &&
    !relation.commercial &&
    !relation.predicate &&
    !relation.purchase
  )
    return false;
  // Heat-pump / HVAC coefficient of performance specifications are not Colombian pesos.
  if (
    candidate.marker.toUpperCase() === 'COP' &&
    /^\s+(?:efficiency|performance|coefficient)\b/i.test(tail) &&
    !relation.cue &&
    !relation.strong &&
    !relation.commercial &&
    !relation.predicate &&
    !relation.purchase &&
    (candidate.amount === null || candidate.amount < 20)
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
    (!relation.cue || relation.cue === 'heading') &&
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
