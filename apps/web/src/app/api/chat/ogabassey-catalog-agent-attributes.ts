import type { StorefrontAgentUiProduct } from '@/schemas/storefront-agent-ui-contract';
import {
  findBoundProducts,
  NEGATION_OR_ABSENCE_CUE,
} from './ogabassey-catalog-agent-product-matching';

const SPEC_CLAIM_PATTERN =
  /\b(\d+(?:\.\d+)?)[\s-]*(gb|tb|mb|mah|hz|khz|mhz|ghz|nits|ppi|mp|mm|cm|watt|watts|hours?|hrs?|cores?|inch(?:es)?)\b|\b(1080p|720p|1440p|2160p|4k|5k|8k)\b/gi;

const WARRANTY_POLICY_COMPAT_PATTERN =
  /\b(warrant(?:y|ies)|guarantee[ds]?|returns?|refund(?:s|able)?|installments?|compatible|compatibility)\b/gi;

const CONDITION_CLAIM_PATTERN =
  /\b(brand[\s-]*new|refurbished|uk[\s-]+used|open[\s-]*box|pre[\s-]*owned)\b/gi;

const COLOR_CLAIM_PATTERN =
  /\b(?:comes?\s+in|available\s+in|in)\s+(?:the\s+)?((?:matte\s+|space\s+|pacific\s+|sierra\s+|alpine\s+|phantom\s+|rose\s+)?(?:black|white|silver|gold|gray|grey|blue|red|green|purple|pink|yellow|orange|beige|brown|coral|violet|teal|navy|maroon|cream|midnight|starlight|graphite|titanium|burgundy))\b|\b(midnight|starlight|space\s+gray|space\s+grey|rose\s+gold|matte\s+black|pacific\s+blue|phantom\s+black|alpine\s+green|sierra\s+blue)\b/gi;

const PROMOTION_CLAIM_PATTERN =
  /\b(?:\d+(?:\.\d+)?%\s*(?:off|discount|cashback|rebate|savings?)|on\s+sale|flash\s+sale|promo(?:tion(?:al)?)?|clearance|price\s+drop|markdown|slashed|reduced\s+from|discounted|discount(?:s)?\s+(?:available|applied|code)|save\s+(?:\d+(?:\.\d+)?%|[₦$€£]\s*\d[\d,.]*))\b/gi;

const TERM_DURATION_PATTERN =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|lifetime)\s*(?:-|\s)*(years?|yrs?|months?|mos?|weeks?|days?)\b|\b(lifetime)\b/gi;

const WORD_NUMBERS: Readonly<Record<string, string>> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  twelve: '12',
  twenty: '20',
  thirty: '30',
};

function buildProductAttributeCorpus(
  product: StorefrontAgentUiProduct
): string {
  return [
    product.name,
    product.description,
    product.category,
    product.condition,
    product.variantModel,
    ...(product.availableConditions ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function normalizeSpecCompact(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, '');
}

function normalizeSpecKey(
  rawNum: string | undefined,
  rawUnit: string | undefined,
  rawTag: string | undefined
): string {
  if (rawTag) return rawTag.toLowerCase();
  const baseUnit = (rawUnit ?? '').toLowerCase().replace(/s$/, '');
  const unit =
    baseUnit === 'hour' || baseUnit === 'hr'
      ? 'hr'
      : baseUnit === 'inche' || baseUnit === 'inch'
        ? 'inch'
        : baseUnit;
  return `${rawNum ?? ''}:${unit}`;
}

function extractNormalizedDurations(value: string): string[] {
  const normalized: string[] = [];
  for (const match of value.matchAll(TERM_DURATION_PATTERN)) {
    if (match[3]) {
      normalized.push('lifetime');
      continue;
    }
    const rawCount = match[1]?.toLowerCase() ?? '';
    const count = WORD_NUMBERS[rawCount] ?? rawCount;
    const rawUnit = match[2]?.toLowerCase() ?? '';
    const unit =
      rawUnit.startsWith('yr') || rawUnit.startsWith('year')
        ? 'year'
        : rawUnit.startsWith('mo')
          ? 'month'
          : rawUnit.replace(/s$/, '');
    normalized.push(`${count}-${unit}`);
  }
  return normalized;
}

function matchesSpecWithBoundary(
  corpus: string,
  rawNum: string | undefined,
  rawUnit: string | undefined,
  rawTag: string | undefined
): boolean {
  const claimedKey = normalizeSpecKey(rawNum, rawUnit, rawTag);
  for (const corpusMatch of corpus.matchAll(SPEC_CLAIM_PATTERN)) {
    if (
      normalizeSpecKey(corpusMatch[1], corpusMatch[2], corpusMatch[3]) ===
      claimedKey
    ) {
      return true;
    }
  }
  return false;
}

/** Rejects ungrounded specs, policy terms, conditions, colors, compatibility, or promos. */
export function hasGroundedSpecAndPolicyClaims(
  text: string,
  products: StorefrontAgentUiProduct[]
): boolean {
  for (const match of text.matchAll(SPEC_CLAIM_PATTERN)) {
    const offset = match.index ?? 0;
    const bound = findBoundProducts(text, offset, products);
    const hasMatch =
      bound.length > 0 &&
      bound.every((product) =>
        matchesSpecWithBoundary(
          buildProductAttributeCorpus(product),
          match[1],
          match[2],
          match[3]
        )
      );
    if (!hasMatch) return false;
  }

  for (const match of text.matchAll(WARRANTY_POLICY_COMPAT_PATTERN)) {
    const offset = match.index ?? 0;
    const before = text.slice(Math.max(0, offset - 28), offset);
    if (NEGATION_OR_ABSENCE_CUE.test(before)) continue;

    const keyword = match[1]?.toLowerCase() ?? '';
    const stem = keyword.startsWith('warrant')
      ? 'warrant'
      : keyword.startsWith('compat')
        ? 'compat'
        : keyword.slice(0, 6);
    const localContext = text.slice(
      Math.max(0, offset - 32),
      Math.min(text.length, offset + match[0].length + 28)
    );
    const claimedDurations = extractNormalizedDurations(localContext);
    const bound = findBoundProducts(text, offset, products);
    const hasMatch =
      bound.length > 0 &&
      bound.every((product) => {
        const corpus = buildProductAttributeCorpus(product);
        if (!corpus.includes(stem)) return false;
        if (claimedDurations.length === 0) return true;
        const productDurations = extractNormalizedDurations(corpus);
        return claimedDurations.every((duration) =>
          productDurations.includes(duration)
        );
      });
    if (!hasMatch) return false;
  }

  for (const match of text.matchAll(CONDITION_CLAIM_PATTERN)) {
    const offset = match.index ?? 0;
    const before = text.slice(Math.max(0, offset - 24), offset);
    if (NEGATION_OR_ABSENCE_CUE.test(before)) continue;

    const normalizedClaim = normalizeSpecCompact(match[1] ?? '');
    const bound = findBoundProducts(text, offset, products);
    const hasMatch =
      bound.length > 0 &&
      bound.every((product) =>
        normalizeSpecCompact(buildProductAttributeCorpus(product)).includes(
          normalizedClaim
        )
      );
    if (!hasMatch) return false;
  }

  for (const match of text.matchAll(COLOR_CLAIM_PATTERN)) {
    const offset = match.index ?? 0;
    const before = text.slice(Math.max(0, offset - 24), offset);
    if (NEGATION_OR_ABSENCE_CUE.test(before)) continue;

    const rawColor = (match[1] ?? match[2] ?? '').toLowerCase();
    const colorWords = rawColor.match(/[a-z]+/g) ?? [];
    if (colorWords.length === 0) continue;
    const bound = findBoundProducts(text, offset, products);
    const hasMatch =
      bound.length > 0 &&
      bound.every((product) => {
        const corpusWords = new Set(
          buildProductAttributeCorpus(product).match(/[a-z]+/g) ?? []
        );
        return colorWords.every((word) => corpusWords.has(word));
      });
    if (!hasMatch) return false;
  }

  for (const match of text.matchAll(PROMOTION_CLAIM_PATTERN)) {
    const offset = match.index ?? 0;
    const before = text.slice(Math.max(0, offset - 28), offset);
    if (NEGATION_OR_ABSENCE_CUE.test(before)) continue;

    const normalizedPromo = match[0].toLowerCase().replace(/\s+/g, ' ');
    const bound = findBoundProducts(text, offset, products);
    const hasMatch =
      bound.length > 0 &&
      bound.every((product) =>
        buildProductAttributeCorpus(product)
          .replace(/\s+/g, ' ')
          .includes(normalizedPromo)
      );
    if (!hasMatch) return false;
  }

  return true;
}
