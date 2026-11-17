import type { StorefrontAgentUiProduct } from '@/schemas/storefront-agent-ui-contract';
import {
  findBoundProducts,
  NEGATION_OR_ABSENCE_CUE,
} from './ogabassey-catalog-agent-product-matching';

const SPEC_CLAIM_PATTERN =
  /\b(\d+(?:\.\d+)?)\s*(gb|tb|mb|mah|hz|khz|mhz|ghz|nits|ppi|mp|mm|cm|watt|watts|hours?|hrs?|cores?|inch(?:es)?)\b|\b(1080p|720p|1440p|2160p|4k|5k|8k)\b/gi;

const WARRANTY_POLICY_COMPAT_PATTERN =
  /\b(warrant(?:y|ies)|guarantee[ds]?|returns?|refund(?:s|able)?|installments?|compatible|compatibility)\b/gi;

const CONDITION_CLAIM_PATTERN =
  /\b(brand[\s-]*new|refurbished|uk[\s-]+used|open[\s-]*box|pre[\s-]*owned)\b/gi;

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

/** Rejects ungrounded hardware specs, conditions, compatibility, or policy claims. */
export function hasGroundedSpecAndPolicyClaims(
  text: string,
  products: StorefrontAgentUiProduct[]
): boolean {
  for (const match of text.matchAll(SPEC_CLAIM_PATTERN)) {
    const offset = match.index ?? 0;
    const rawNum = match[1];
    const rawUnit = match[2];
    const rawTag = match[3];
    const compactNeedle = rawTag
      ? rawTag.toLowerCase()
      : `${rawNum}${rawUnit?.toLowerCase().replace(/s$/, '') ?? ''}`;

    const bound = findBoundProducts(text, offset, products);
    const hasMatch = bound.some((product) => {
      const compactCorpus = normalizeSpecCompact(
        buildProductAttributeCorpus(product)
      );
      return compactCorpus.includes(compactNeedle);
    });
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
    const bound = findBoundProducts(text, offset, products);
    const hasMatch = bound.some((product) =>
      buildProductAttributeCorpus(product).includes(stem)
    );
    if (!hasMatch) return false;
  }

  for (const match of text.matchAll(CONDITION_CLAIM_PATTERN)) {
    const offset = match.index ?? 0;
    const before = text.slice(Math.max(0, offset - 24), offset);
    if (NEGATION_OR_ABSENCE_CUE.test(before)) continue;

    const normalizedClaim = normalizeSpecCompact(match[1] ?? '');
    const bound = findBoundProducts(text, offset, products);
    const hasMatch = bound.some((product) =>
      normalizeSpecCompact(buildProductAttributeCorpus(product)).includes(
        normalizedClaim
      )
    );
    if (!hasMatch) return false;
  }

  return true;
}
