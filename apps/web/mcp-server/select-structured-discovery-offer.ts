import { normalizeCanonicalProductCondition, toGoogleListingCondition } from '@baci/shared/lib';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { isPublicVariantPurchasable } from '../src/lib/is-public-variant-purchasable';
import { getEffectiveStock } from '../src/lib/product-stock';
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
  pairedVariant?: unknown;
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
  candidate: Pick<Candidate, 'attributes'>,
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
  const parentStock = {
    manage_stock: product.manage_stock === null || typeof product.manage_stock === 'boolean'
      ? product.manage_stock
      : undefined,
    stock: typeof product.stock === 'number' ? product.stock : null,
    stock_quantity: typeof product.stock_quantity === 'number' ? product.stock_quantity : null,
  };
  // PDP rule on the projected effective policy, matching hydration.
  const purchasableVariant = (rawVariant: unknown): boolean => {
    const variant = record(rawVariant);
    return isPublicVariantPurchasable(parentStock, {
      inventory_tracking_policy: typeof variant.effective_policy === 'string'
        ? variant.effective_policy
        : undefined,
      stock_quantity: typeof variant.stock_quantity === 'number' ? variant.stock_quantity : null,
    });
  };
  const metadataAttributes = record(discovery.attributes);
  const baseCondition = normalizeCanonicalProductCondition(
    typeof product.condition === 'string' ? product.condition : null
  ) || 'new';

  const addCandidate = (candidate: Candidate) => {
    if (candidate.price < (budget.min_price ?? Number.NEGATIVE_INFINITY)) return;
    if (candidate.price > (budget.max_price ?? Number.POSITIVE_INFINITY)) return;
    candidates.push(candidate);
  };
  // One normalization per variant per product: the variant loop and every
  // offer pairing share this instead of renormalizing the same attributes.
  const normalizedVariantAttributes = new Map<unknown, Record<string, unknown>>();
  const normalizedAttributesOf = (rawVariant: unknown) => {
    let normalized = normalizedVariantAttributes.get(rawVariant);
    if (!normalized) {
      normalized = normalizeDiscoveryOptionAttributes(record(record(rawVariant).attributes));
      normalizedVariantAttributes.set(rawVariant, normalized);
    }
    return normalized;
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
      if (!purchasableVariant(rawVariant)) continue;
      const price = finitePrice(variant.price_override) ?? finitePrice(product.price);
      if (price === undefined) continue;
      const variantCondition = typeof variant.condition === 'string' ? variant.condition : null;
      // PDP parity: product-detail-client resolves the comparison price as
      // the variant's own value with an unconditional parent fallback, even
      // when an override moved the selling price.
      addCandidate({ kind: 'variant', attributes: normalizedAttributesOf(rawVariant),
        condition: normalizeCanonicalProductCondition(variantCondition) || baseCondition,
        price, compareAtPrice: finitePrice(variant.compare_at_price)
          ?? finitePrice(product.compare_at_price) ?? null,
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
  // Variant products need a purchasable variant for offers (the PDP blocks
  // add-to-cart without one); duplicate canonical conditions resolve to the
  // first row like the PDP find(). The universe check sees every variant
  // like hasVariantConditionAxis (hydration filters by condition, so the
  // filtered list can be empty while selectable variants exist), and
  // purchasability ignores the requested condition because the PDP lets a
  // condition offer combine with any selectable variant when offers own it.
  const variantUniverse = row.allVariants ?? row.availableVariants;
  const offersSelectable = !structuredDiscoveryIdentity.variantsOwnConditionAxis(product, variantUniverse) &&
    (!product.has_variants || variantUniverse.some((rawVariant) => {
      const variant = record(rawVariant);
      if (!purchasableVariant(rawVariant)) return false;
      return (finitePrice(variant.price_override) ?? finitePrice(product.price)) !== undefined;
    }));
  // Paired offers skip the offer-stock rejection: the PDP replaces offer
  // stock with the selected variant's stock (bare offers keep the check).
  const pairings = product.has_variants === true
    ? variantUniverse.filter((rawVariant) => purchasableVariant(rawVariant))
    : [];
  const rejectBareOfferStock = manageStock && pairings.length === 0;
  const seenOfferConditions = new Set<string>();
  for (const rawOffer of offersSelectable ? row.availableOffers ?? [] : []) {
    const offer = record(rawOffer);
    if (toGoogleListingCondition(typeof offer.condition === 'string' ? offer.condition : null) === parentListingCondition) continue;
    // PDP parity: product.offers.find() keeps the first canonical match with
    // no stock check, so the first row claims the condition even when it is
    // out of stock and a later in-stock duplicate must not surface instead.
    const canonicalOfferCondition = normalizeCanonicalProductCondition(typeof offer.condition === 'string' ? offer.condition : null);
    if (!canonicalOfferCondition || seenOfferConditions.has(canonicalOfferCondition)) continue;
    seenOfferConditions.add(canonicalOfferCondition);
    if (rejectBareOfferStock && !hasPositiveStock(offer.stock_quantity)) continue;
    const price = finitePrice(offer.price);
    if (price === undefined) continue;
    // PDP parity: the PDP prices the selected offer but always sources the
    // comparison price from the selected variant or parent product, never
    // the offer's own compare-at value.
    const productCompareAtPrice = finitePrice(product.compare_at_price) ?? null;
    const offerCore = { kind: 'offer' as const,
      condition: normalizeCanonicalProductCondition(typeof offer.condition === 'string' ? offer.condition : null) || baseCondition,
      price, stockQuantity: offer.stock_quantity, sourceOption: rawOffer };
    // Offers pair with every selectable variant (PDP selects both
    // independently) while one bare candidate survives for spec-less
    // intents. Pairs evaluate before allocating (memoized per variant),
    // so only matching pairs become candidates.
    if (pairings.length === 0) addCandidate({ ...offerCore, attributes: {}, compareAtPrice: productCompareAtPrice });
    for (const rawVariant of pairings) {
      // PDP parity: resolveCurrentOffer replaces any selected offer price
      // with the variant price whenever a variant is selected, so a paired
      // candidate is priced by its variant, never the offer row.
      const pairedPrice = finitePrice(record(rawVariant).price_override)
        ?? finitePrice(product.price);
      if (pairedPrice === undefined) continue;
      if (pairedPrice < (budget.min_price ?? Number.NEGATIVE_INFINITY)) continue;
      if (pairedPrice > (budget.max_price ?? Number.POSITIVE_INFINITY)) continue;
      const normalized = normalizedAttributesOf(rawVariant);
      const evaluations = intent.alternatives.map((alternative) =>
        matchesAlternative(product, { attributes: { ...metadataAttributes, ...normalized } },
          discovery, alternative, excludedTypes));
      if (!evaluations.includes(true)) {
        if (evaluations.includes(undefined)) onUnverifiedFacts?.();
        continue;
      }
      addCandidate({ ...offerCore, price: pairedPrice, pairedVariant: rawVariant,
        compareAtPrice: finitePrice(record(rawVariant).compare_at_price) ?? productCompareAtPrice,
        attributes: normalized });
    }
  }

  const matches = candidates
    .map((candidate) => ({
      ...candidate,
      // Product metadata merges under variant-proven attributes; only bare
      // offers skip the merge (no live variant scopes them).
      attributes: candidate.kind === 'offer' && candidate.pairedVariant === undefined
        && product.has_variants === true
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

  // A paired offer summarizes its variant alone (PDP: variant stock
  // replaces the offer's); bare offers keep the offer-only summary.
  const pairedOffer = match.kind === 'offer' && match.pairedVariant !== undefined;
  // Legacy null child quantities inherit the parent stock, mirroring
  // isPublicVariantPurchasable; raw null is read before coercion to zero.
  const childStock = (rawQuantity: unknown) =>
    stockQuantity(rawQuantity == null ? getEffectiveStock(parentStock) : rawQuantity);
  // A serialized_strict selection is stock-gated by projected units even
  // under an unmanaged parent; other policies keep the parent's state.
  const selectedPolicy = match.kind === 'variant' ? record(match.sourceOption).effective_policy
    : pairedOffer ? record(match.pairedVariant).effective_policy : undefined;
  const stockSummary = getMcpProductStockSummary({
    ...product,
    manage_stock: selectedPolicy === 'serialized_strict' ? true : product.manage_stock,
    has_variants: match.kind === 'variant',
    has_condition_offers: match.kind === 'offer' && !pairedOffer,
    stock_quantity: match.kind === 'base' ? stockQuantity(product.stock_quantity)
      : pairedOffer
        ? childStock(record(match.pairedVariant).stock_quantity) ?? 0
      : 0,
  }, match.kind === 'variant' ? [{ stock_quantity: childStock(match.stockQuantity) }] : undefined,
  match.kind === 'offer' && !pairedOffer ? [{ stock_quantity: stockQuantity(match.stockQuantity) }] : undefined);

  return {
    ...row,
    availableVariants: matches.flatMap((candidate) =>
      candidate.kind === 'variant' && candidate.sourceOption
        ? [candidate.sourceOption as (typeof row.availableVariants)[number]]
        : candidate.kind === 'offer' && candidate.pairedVariant !== undefined
          ? [candidate.pairedVariant as (typeof row.availableVariants)[number]] : []),
    displayPrice: match.price,
    displayCondition: match.condition,
    displayCompareAtPrice: match.compareAtPrice,
    stockSummary,
    selectedOption: {
      kind: match.kind,
      ...(match.kind !== 'base' && typeof record(match.sourceOption).id === 'string'
        ? { option_id: record(match.sourceOption).id as string }
        : {}),
      // Paired offers resolve by condition on the PDP but price by variant,
      // so the paired variant ID travels with the selection for option-aware
      // links; without it the PDP would open the default variant.
      ...(pairedOffer && typeof record(match.pairedVariant).id === 'string'
        ? { variantId: record(match.pairedVariant).id as string }
        : {}),
      attributes: match.attributes,
      condition: match.condition,
      price: match.price,
    },
  };
}
