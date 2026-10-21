import { decodeHTML } from 'entities';
import {
  getProductSeoMoneyCandidates,
  type ProductSeoMoneyCandidate,
} from './get-product-seo-money-candidates';
import { stripHtmlTags } from './sanitize-core';
import { stripVolatileProductPriceSentences } from './storefront-product-description';
import {
  getSeoProductName,
  normalizeSeoProductText,
} from './storefront-product-slug-disambiguation';

const MAX_SOURCE_LENGTH = 20_000;
const MAX_NAME_LENGTH = 1_000;
const QUANTITY_UNIT =
  /^\s*(?:units?|photos?|songs?|files?|people|users?|models?|colou?rs?|options?|sizes?|picks?|years?|hours?|cycles?|washes|uses|mah|gb|tb|mb|hz|mp|watts?)\b/i;
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
  /^\s+(?:(?:gift[- ]card\s+)?bonus|cashback|cash\s+back|trade[- ]in\s+credit|credit|rebate|reward|discount)\b/i;
const MAGNITUDE_SPECIFICATION_UNIT =
  /^\s+(?:display|screen|resolution|video|recording|camera|photos?|pixels?)\b/i;

function retailRelation(text: string, start: number) {
  const clause =
    text
      .slice(Math.max(0, start - 200), start)
      .split(/[.!?;\n]/)
      .at(-1) ?? '';
  const cue =
    /\b(prices?(?:\s+(?:is|from))?|costs?|priced\s+at|starts?\s+at|pay(?:\s+only)?|only|from|for|at)\s*[:–—-]?\s*(?:(?:just|only|about|around|approximately)\s+){0,2}$/i.exec(
      clause
    )?.[1] ?? '';
  const predicate =
    /\b(?:prices?|costs?)(?:\s+(?:in|of|for)\s+(?:(?!(?:and|or|but|whose|which|that|where)\b)[\p{L}\p{N}'-]+\s*){1,8})?\s*(?:\b(?:is|was|are|were)\b|:)\s*$/iu.test(
      clause
    );
  return {
    cue,
    predicate,
    separator: /^\s*[:–—-]?\s*$/.test(clause),
    strong: /^(?:price|cost|priced|start|pay|only)/i.test(cue),
    purchase:
      /\b(?:buy|purchase)\b/i.test(clause) ||
      /\b(?:get(?!\s+(?:ready|prepared|started)\b)|shop)(?:\s+[^.!?;\n]{1,80})?\s+for\s*$/i.test(
        clause
      ),
  };
}

function isPrice(candidate: ProductSeoMoneyCandidate, text: string): boolean {
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
    lastCueIndex(/\b(?:weigh|weighs|weighing|weight)\b/gi) >
      lastCueIndex(
        /\b(?:cost|costs|price|prices|priced|buy|purchase|pay|sell)\b/gi
      );
  if (physicalPounds) return false;
  const quantity =
    QUANTITY_UNIT.test(tail) ||
    (LIFESPAN_QUANTITY_UNIT.test(tail) &&
      !/^\s+per\s+(?:hours?|cycles?|washes|uses)\b/i.test(tail)) ||
    (/^\d{1,2}$/.test(rawAmount) && MODIFIED_COUNT_UNIT.test(tail));
  if (!candidate.marker) {
    if (
      (!relation.cue && !relation.predicate && !relation.separator) ||
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
      /[,km]/i.test(rawAmount) ||
      rawAmount.replace(/\D/g, '').length >= 5
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
  // AMD is both a currency and a hardware brand; the following noun disambiguates.
  if (
    candidate.marker.toUpperCase() === 'AMD' &&
    !relation.cue &&
    !relation.predicate &&
    (/^\s+(?:(?:XT|XTX|GRE|G|X|PRO)\s+)?(?:processors?|cpus?|gpus?|graphics)\b/i.test(
      text.slice(candidate.end)
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

function isDenomination(
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
  const label =
    /^\s+((?:[\p{L}][\p{L}\p{N}'-]{0,30}\s+){0,4})(?:gift[- ]card|value|credit|denomination)\b/iu.exec(
      text.slice(candidate.end)
    );
  if (!label) return false;
  const identityWords = new Set(
    productName.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? []
  );
  return label[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => identityWords.has(word.toLowerCase()));
}

/** Keeps editorial copy price-free across currencies; offers supply live prices. */
export function getDurableProductSeoText({
  text,
  product,
}: {
  text: string | null | undefined;
  product: { name: string; slug?: string | null };
}): string {
  if (
    typeof text !== 'string' ||
    text.length > MAX_SOURCE_LENGTH ||
    product.name.length > MAX_NAME_LENGTH ||
    (product.slug?.length ?? 0) > MAX_NAME_LENGTH
  )
    return '';
  const productName = stripHtmlTags(decodeHTML(getSeoProductName(product)));
  const plainText = stripHtmlTags(
    decodeHTML(
      normalizeSeoProductText(stripVolatileProductPriceSentences(text), product)
    )
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !plainText ||
    /\bconfirm specs\W+condition\W+variants\W+(?:and\W+)?availability\b/i.test(
      plainText
    )
  )
    return '';
  const monetaryText = productName.trim()
    ? [
        productName,
        stripHtmlTags(decodeHTML(getSeoProductName({ name: product.name }))),
      ].reduce((result, identity) => {
        if (!identity) return result;
        return result.replace(
          new RegExp(identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
          ''
        );
      }, plainText)
    : plainText;
  const denominations = /\bgift[- ]card\b/i.test(productName)
    ? getProductSeoMoneyCandidates(productName).filter((value) => value.marker)
    : [];
  return getProductSeoMoneyCandidates(monetaryText).some((candidate) => {
    const relation = retailRelation(monetaryText, candidate.start);
    const clearlyNonRetail =
      !relation.strong &&
      !relation.predicate &&
      NON_RETAIL_AMOUNT_LABEL.test(monetaryText.slice(candidate.end));
    return (
      isPrice(candidate, monetaryText) &&
      !clearlyNonRetail &&
      !isDenomination(candidate, monetaryText, productName, denominations)
    );
  })
    ? ''
    : plainText;
}
