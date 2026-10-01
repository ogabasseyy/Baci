import { normalizeCanonicalProductCondition, toGoogleListingCondition } from '@baci/shared/lib';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { normalizeDiscoveryOptionAttributes } from './normalize-discovery-option-attributes';
import type { hydrateSearchProductAvailability } from './search-product-availability';
import { structuredDiscoveryIdentity } from './structured-discovery-identity';
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

function matchesAlternative(
  product: Record<string, unknown>,
  candidate: Candidate,
  discovery: Record<string, unknown>,
  alternative: DiscoveryAlternative,
  excludedTypes: Set<string>
) {
  const productType = structuredDiscoveryIdentity.productTypeOf(product, discovery);
  const identity = structuredDiscoveryIdentity.evaluateAlternativeIdentity(product, discovery, alternative, excludedTypes, productType);
  if (identity.excluded) return false;
  let unverified = identity.unverified;

  const attributes = candidate.attributes;
  const attributesMatch = (alternative.attributes ?? []).every(({ key, operator, value }) => {
    const normalizedKey = key.trim().toLocaleLowerCase('en-US');
    const actual = attributes[normalizedKey] ?? attributes[key];
    if (actual === undefined || actual === null) { unverified = true; return true; }
    if (operator === 'eq') {
      if (typeof value === 'number') return typeof actual === 'number' && Number.isFinite(actual) && actual === value;
      const expected = structuredDiscoveryIdentity.normalizeText(value);
      return expected !== undefined && structuredDiscoveryIdentity.normalizeText(actual) === expected;
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
  const discovery = structuredDiscoveryIdentity.metadataOf(product);
  const excludedTypes = structuredDiscoveryIdentity.excludedTypesOf(intent);
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

  // Same-condition offers serve the parent price on the PDP and are never sold
  // through directly, so selection must not advertise them as options. Only
  // the condition comparison is borrowed here: feed-row concerns from the
  // shared eligibility helper (row identity, first-per-condition) do not
  // apply to cheapest-option selection.
  const parentListingCondition = toGoogleListingCondition(
    typeof product.condition === 'string' ? product.condition : null) ?? 'new';
  // PDP parity: variants owning the condition axis disable offers entirely,
  // offers on variant products need a purchasable variant (the PDP blocks
  // add-to-cart without one), and duplicate canonical conditions resolve to
  // the first row like the PDP find().
  // PDP mirrors over the unfiltered variant set (falling back for rows built
  // without it): the axis check sees every variant like hasVariantConditionAxis,
  // and purchasability ignores the requested condition because the PDP lets a
  // condition offer combine with any selectable variant when offers own the axis.
  const variantUniverse = row.allVariants ?? row.availableVariants;
  const variantsOwnConditionAxis = product.has_variants === true && variantUniverse.some((rawVariant) => {
    const variantCondition = record(rawVariant).condition;
    return normalizeCanonicalProductCondition(typeof variantCondition === 'string' ? variantCondition : null) !== '';
  });
  const offersSelectable = !variantsOwnConditionAxis &&
    (!product.has_variants || variantUniverse.some((rawVariant) => {
      const variant = record(rawVariant);
      if (manageStock && !hasPositiveStock(variant.stock_quantity)) return false;
      return (finitePrice(variant.price_override) ?? finitePrice(product.price)) !== undefined;
    }));
  const seenOfferConditions = new Set<string>();
  for (const rawOffer of offersSelectable ? row.availableOffers ?? [] : []) {
    const offer = record(rawOffer);
    if (toGoogleListingCondition(typeof offer.condition === 'string' ? offer.condition : null) === parentListingCondition) continue;
    if (manageStock && !hasPositiveStock(offer.stock_quantity)) continue;
    const price = finitePrice(offer.price);
    if (price === undefined) continue;
    const canonicalOfferCondition = normalizeCanonicalProductCondition(typeof offer.condition === 'string' ? offer.condition : null);
    if (!canonicalOfferCondition || seenOfferConditions.has(canonicalOfferCondition)) continue;
    seenOfferConditions.add(canonicalOfferCondition);
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
