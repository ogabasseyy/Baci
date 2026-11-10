import type { RetailRelation } from './classify-durable-product-seo-retail-relation';
import type { ProductSeoMoneyCandidate } from './get-product-seo-money-candidates';

const CLOCK_TIME_TAIL =
  /^(?:[:.]\d{2}\s*(?:am|pm|gmt|utc|est|pst|cst|bst|cet)\b|:\d{2}\b|\s*(?:am|pm)\b)/i;

const SHORT_RESOLUTION_CONTEXT =
  /\b(?:video|resolution|stream(?:ing)?|record(?:ing)?|shoot(?:ing)?|upscal\w*|frame\s+rate|fps)\b/i;

const MONTH_NAMES =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)';

const DAY_FOLLOWED_BY_MONTH = new RegExp(
  `^\\s*(?:st|nd|rd|th)?(?:\\s+of)?\\s+(?:${MONTH_NAMES})\\b(?:\\s*,?\\s*(?:19|20)\\d{2}\\b)?`,
  'i'
);
const MONTH_BEFORE_DAY = new RegExp(`\\b(?:${MONTH_NAMES})\\s*$`, 'i');
const MONTH_DAY_BEFORE_YEAR = new RegExp(
  `\\b(?:(?:${MONTH_NAMES})\\s+(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?|(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?(?:\\s+of)?\\s+(?:${MONTH_NAMES}))\\s*,?\\s*$`,
  'i'
);
const ISO_YEAR_TAIL = /^[-/](?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])\b/;
const ISO_DAY_TAIL = /^[-/](?:0?[1-9]|1[0-2])[-/](?:19|20)\d{2}\b/;

function isCalendarDate(
  rawAmount: string,
  tail: string,
  nearbyPrefix: string
): boolean {
  if (/^(?:19|20)\d{2}$/.test(rawAmount)) {
    if (ISO_YEAR_TAIL.test(tail)) return true;
    if (MONTH_DAY_BEFORE_YEAR.test(nearbyPrefix)) return true;
    if (
      /(?:0?[1-9]|[12]\d|3[01])[-/](?:0?[1-9]|1[0-2])[-/]$/.test(nearbyPrefix)
    )
      return true;
  }
  if (/^(?:0?[1-9]|[12]\d|3[01])$/.test(rawAmount)) {
    if (DAY_FOLLOWED_BY_MONTH.test(tail)) return true;
    if (MONTH_BEFORE_DAY.test(nearbyPrefix)) return true;
    if (ISO_DAY_TAIL.test(tail)) return true;
  }
  if (
    /(?:19|20)\d{2}[-/]$/.test(nearbyPrefix) &&
    /^[-/](?:0?[1-9]|[12]\d|3[01])\b/.test(tail)
  )
    return true;
  if (/(?:19|20)\d{2}[-/](?:0?[1-9]|1[0-2])[-/]$/.test(nearbyPrefix))
    return true;
  if (
    /(?:0?[1-9]|[12]\d|3[01])[-/]$/.test(nearbyPrefix) &&
    /^[-/](?:19|20)\d{2}\b/.test(tail)
  )
    return true;
  return false;
}

export function isNonMonetarySeoAmountContext(
  candidate: ProductSeoMoneyCandidate,
  text: string,
  relation: RetailRelation
): boolean {
  const rawAmount = candidate.rawAmount.replace(/[.,]+$/, '');
  const tail = text.slice(candidate.end);
  const nearbyPrefix = text.slice(
    Math.max(0, candidate.start - 80),
    candidate.start
  );
  const nearbyClause = nearbyPrefix.split(/[.!?;\n]/).at(-1) ?? '';
  const followingClause = tail.split(/[.!?;\n]/)[0] ?? '';

  if (!candidate.marker) {
    if (
      /^(?:19|20)\d{2}$/.test(rawAmount) &&
      /^\s*\)\s*[.!?]?\s*$/.test(tail)
    ) {
      return true;
    }
    if (CLOCK_TIME_TAIL.test(tail)) {
      return true;
    }
    if (isCalendarDate(rawAmount, tail, nearbyPrefix)) {
      return true;
    }
    if (
      /^\d{1,2}k$/i.test(rawAmount) &&
      SHORT_RESOLUTION_CONTEXT.test(`${nearbyClause} ${followingClause}`) &&
      !relation.strong &&
      !relation.predicate &&
      !relation.purchase &&
      !relation.commercial
    ) {
      return true;
    }
  }

  const isPound = ['POUND', 'POUNDS'].includes(candidate.marker.toUpperCase());
  if (isPound && !relation.cue && !relation.predicate) {
    const lastCueIndex = (pattern: RegExp) =>
      [...nearbyPrefix.matchAll(pattern)].at(-1)?.index ?? -1;
    const isWeight =
      lastCueIndex(
        /\b(?:weigh|weighs|weighing|weight|load(?:\s+capacity)?|payload(?:\s+capacity)?|capacity)\b/gi
      ) >
        lastCueIndex(
          /\b(?:cost|costs|price|prices|priced|buy|purchase|pay|sell)\b/gi
        ) ||
      (/^\s+of\b/i.test(tail) &&
        /\b(?:contains?|containing|comprises?|holds?)\b/i.test(nearbyClause));
    if (isWeight) return true;
  }

  const markerUpper = candidate.marker.toUpperCase();
  const hasExplicitRetailContext =
    relation.strong ||
    relation.predicate ||
    relation.purchase ||
    relation.commercial;

  if (markerUpper === 'SAR' && /^\s*W\s*\/\s*kg\b/i.test(tail)) {
    return true;
  }
  if (
    markerUpper === 'PHP' &&
    /^\s+(?:and\s+)?(?:MySQL|runtime|version)\b/i.test(tail) &&
    !relation.cue &&
    !hasExplicitRetailContext
  ) {
    return true;
  }
  if (
    markerUpper === 'COP' &&
    /^\s+(?:efficiency|performance|coefficient)\b/i.test(tail) &&
    !relation.cue &&
    !hasExplicitRetailContext &&
    (candidate.amount === null || candidate.amount < 20)
  ) {
    return true;
  }
  if (
    markerUpper === 'CAD' &&
    /^(?:19|20)\d{2}$/.test(rawAmount) &&
    /^\s+(?:software|version|design)\b/i.test(tail)
  ) {
    return true;
  }
  if (
    markerUpper === 'AMD' &&
    (!relation.cue || relation.cue === 'heading') &&
    !relation.predicate &&
    (/^\s+(?:(?:XT|XTX|GRE|G|X|PRO)\s+)?(?:processors?|cpus?|gpus?|graphics)\b/i.test(
      tail
    ) ||
      /\bpowered\s+by\s*$/i.test(
        text.slice(Math.max(0, candidate.start - 30), candidate.start)
      ))
  ) {
    return true;
  }

  return false;
}
