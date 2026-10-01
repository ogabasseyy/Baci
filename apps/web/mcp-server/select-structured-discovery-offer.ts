import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { canonicalizeDiscoveryProductType } from '../src/schemas/canonical-discovery-product-type';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { productDiscoveryMetadataSchema } from '../src/schemas/product-discovery-metadata';
import { normalizeDiscoveryOptionAttributes } from './normalize-discovery-option-attributes';
import type { hydrateSearchProductAvailability } from './search-product-availability';
import { getMcpProductStockSummary } from './product-stock-summary';

type HydratedProduct = Awaited<ReturnType<typeof hydrateSearchProductAvailability>>[number];
type DiscoveryAlternative = McpDiscoveryIntent['alternatives'][number];

type Candidate = {
  kind: 'base' | 'variant' | 'offer';
  attributes: Record<string, unknown>;
  condition: string;
  price: number;
  compareAtPrice: number | null;
  stockQuantity?: unknown;
  sourceOption?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalized(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
  return result || undefined;
}

function finitePrice(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function hasPositiveStock(value: unknown) {
  const quantity = Number(value ?? 0);
  return Number.isFinite(quantity) && quantity > 0;
}

function stockQuantity(value: unknown): number | null {
  const quantity = Number(value ?? 0);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

function getDiscoveryMetadata(product: Record<string, unknown>) {
  const parsed = productDiscoveryMetadataSchema.safeParse(product.discovery_metadata);
  return parsed.success ? parsed.data : {};
}

function discoveryProductType(product: Record<string, unknown>, discovery: Record<string, unknown>) {
  // The schema canonicalizes hyphens/spaces to underscores on parse, so the
  // stored side must canonicalize too or 'security-camera' never equals
  // intent 'security_camera'.
  const explicit = normalized(discovery.product_type);
  if (explicit) return canonicalizeDiscoveryProductType(explicit);
  const category = normalized(product.category);
  if (category === 'smartphones') return 'phone';
  if (category === 'laptops') return 'laptop';
  if (category === 'tablets') return 'tablet';
  return undefined;
}

function matchesAlternative(
  product: Record<string, unknown>,
  candidate: Candidate,
  discovery: Record<string, unknown>,
  alternative: DiscoveryAlternative,
  excludedTypes: Set<string>
) {
  let unverified = false;
  const productType = discoveryProductType(product, discovery);
  if (excludedTypes.size > 0 && !productType) unverified = true;
  if (productType && excludedTypes.has(productType)) return false;

  if (alternative.product_type !== undefined) {
    const expectedRaw = normalized(alternative.product_type);
    if (!expectedRaw) return false;
    const expected = canonicalizeDiscoveryProductType(expectedRaw);
    if (!productType) unverified = true;
    else if (productType !== expected) return false;
  }
  if (alternative.brands !== undefined) {
    const brand = normalized(product.brand);
    const allowedBrands = alternative.brands.map(normalized).filter((value): value is string => Boolean(value));
    if (!brand) unverified = true;
    else if (!allowedBrands.includes(brand)) return false;
  }
  if (alternative.model !== undefined) {
    const model = normalized(discovery.model);
    const expected = normalized(alternative.model);
    if (!expected) return false;
    if (!model) unverified = true;
    else if (model !== expected) return false;
  }
  if (alternative.compatible_with !== undefined) {
    const compatibility = Array.isArray(discovery.compatible_with)
      ? discovery.compatible_with.map(normalized).filter((value): value is string => Boolean(value))
      : [];
    const expected = normalized(alternative.compatible_with);
    if (!expected) return false;
    if (compatibility.length === 0) unverified = true;
    else if (!compatibility.includes(expected)) return false;
  }

  const attributes = candidate.attributes;
  const attributesMatch = (alternative.attributes ?? []).every(({ key, operator, value }) => {
    const normalizedKey = key.trim().toLocaleLowerCase('en-US');
    const actual = attributes[normalizedKey] ?? attributes[key];
    if (actual === undefined || actual === null) { unverified = true; return true; }
    if (operator === 'eq') {
      if (typeof value === 'number') return typeof actual === 'number' && Number.isFinite(actual) && actual === value;
      const expected = normalized(value);
      return expected !== undefined && normalized(actual) === expected;
    }
    if (typeof value !== 'number' || typeof actual !== 'number' || !Number.isFinite(value) || !Number.isFinite(actual)) {
      return false;
    }
    return operator === 'gte' ? actual >= value : actual <= value;
  });
  return !attributesMatch ? false : unverified ? undefined : true;
}

/** Selects the cheapest purchasable concrete option that satisfies one complete structured alternative. */
export function selectStructuredDiscoveryOffer(
  row: HydratedProduct,
  intent: McpDiscoveryIntent,
  budget: { min_price?: number; max_price?: number } = {},
  onUnverifiedFacts?: () => void
) {
  const product = row.product as Record<string, unknown>;
  const discovery = getDiscoveryMetadata(product);
  const excludedTypes = new Set((intent.excluded_product_types ?? []).map(normalized)
    .filter((value): value is string => Boolean(value)).map(canonicalizeDiscoveryProductType));
  const candidates: Candidate[] = [];
  const manageStock = product.manage_stock === true;
  const metadataAttributes = record(discovery.attributes);
  const baseCondition = normalizeCanonicalProductCondition(
    typeof product.condition === 'string' ? product.condition : null
  ) || 'new';

  const addCandidate = (candidate: Candidate) => {
    if (candidate.price < (budget.min_price ?? Number.NEGATIVE_INFINITY)) return;
    if (candidate.price > (budget.max_price ?? Number.POSITIVE_INFINITY)) return;
    candidates.push(candidate);
  };

  if (product.has_variants !== true) {
    const baseAvailable = row.basePurchasable === true;
    const price = finitePrice(product.price);
    if (baseAvailable && price !== undefined) addCandidate({
      kind: 'base', attributes: metadataAttributes, condition: baseCondition,
      price, compareAtPrice: finitePrice(product.compare_at_price) ?? null,
      stockQuantity: product.stock_quantity,
    });
  }

  if (product.has_variants === true) {
    for (const rawVariant of row.availableVariants) {
      const variant = record(rawVariant);
      if (manageStock && !hasPositiveStock(variant.stock_quantity)) continue;
      const price = finitePrice(variant.price_override) ?? finitePrice(product.price);
      if (price === undefined) continue;
      const variantCondition = typeof variant.condition === 'string'
        ? variant.condition
        : typeof record(variant.attributes).condition === 'string'
          ? record(variant.attributes).condition as string
          : null;
      addCandidate({ kind: 'variant', attributes: normalizeDiscoveryOptionAttributes(record(variant.attributes)),
        condition: normalizeCanonicalProductCondition(variantCondition) || baseCondition,
        price, compareAtPrice: price === finitePrice(product.price)
          ? finitePrice(product.compare_at_price) ?? null : null,
        stockQuantity: variant.stock_quantity, sourceOption: rawVariant });
    }
  }

  for (const rawOffer of row.availableOffers ?? []) {
    const offer = record(rawOffer);
    if (manageStock && !hasPositiveStock(offer.stock_quantity)) continue;
    const price = finitePrice(offer.price);
    if (price === undefined) continue;
    addCandidate({ kind: 'offer', attributes: {},
      condition: normalizeCanonicalProductCondition(typeof offer.condition === 'string' ? offer.condition : null) || baseCondition,
      price, compareAtPrice: finitePrice(offer.compare_at_price) ?? null,
      stockQuantity: offer.stock_quantity, sourceOption: rawOffer });
  }

  const matches = candidates
    .map((candidate) => ({
      ...candidate,
      // Condition offers carry no spec attributes of their own, and on variant
      // products the base metadata may describe a different variant, so offers
      // there must not inherit it for spec matching.
      attributes: candidate.kind === 'offer' && product.has_variants === true
        ? candidate.attributes
        : { ...metadataAttributes, ...candidate.attributes },
    }))
    .filter((candidate) => {
      const evaluations = intent.alternatives.map((alternative) =>
        matchesAlternative(product, candidate, discovery, alternative, excludedTypes));
      if (evaluations.includes(true)) return true;
      if (evaluations.includes(undefined)) onUnverifiedFacts?.();
      return false;
    })
    .sort((left, right) => left.price - right.price);
  const match = matches[0];
  if (!match) return undefined;

  const stockSummary = getMcpProductStockSummary({
    ...product,
    has_variants: match.kind === 'variant',
    has_condition_offers: match.kind === 'offer',
    stock_quantity: match.kind === 'base' ? stockQuantity(product.stock_quantity) : 0,
  }, match.kind === 'variant' ? [{ stock_quantity: stockQuantity(match.stockQuantity) }] : undefined,
  match.kind === 'offer' ? [{ stock_quantity: stockQuantity(match.stockQuantity) }] : undefined);

  return {
    ...row,
    availableVariants: matches.flatMap((candidate) =>
      candidate.kind === 'variant' && candidate.sourceOption
        ? [candidate.sourceOption as (typeof row.availableVariants)[number]] : []),
    displayPrice: match.price,
    displayCondition: match.condition,
    displayCompareAtPrice: match.compareAtPrice,
    stockSummary,
    selectedOption: {
      kind: match.kind,
      ...(match.kind !== 'base' && typeof record(match.sourceOption).id === 'string'
        ? { option_id: record(match.sourceOption).id as string }
        : {}),
      attributes: match.attributes,
      condition: match.condition,
      price: match.price,
    },
  };
}
