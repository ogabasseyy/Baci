import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { canonicalizeDiscoveryProductType } from '../src/schemas/canonical-discovery-product-type';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { productDiscoveryMetadataSchema } from '../src/schemas/product-discovery-metadata';
import type { hydrateSearchProductAvailability } from './search-product-availability';

type HydratedProduct = Awaited<ReturnType<typeof hydrateSearchProductAvailability>>[number];
type DiscoveryAlternative = McpDiscoveryIntent['alternatives'][number];
type IdentityVerdict = { excluded: boolean; unverified: boolean };

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.normalize('NFC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
  return result || undefined;
}

function metadataOf(product: Record<string, unknown>) {
  const parsed = productDiscoveryMetadataSchema.safeParse(product.discovery_metadata);
  return parsed.success ? parsed.data : {};
}

function productTypeOf(product: Record<string, unknown>, discovery: Record<string, unknown>) {
  // The schema canonicalizes hyphens/spaces to underscores on parse, so the
  // stored side must canonicalize too or 'security-camera' never equals
  // intent 'security_camera'.
  const explicit = normalizeText(discovery.product_type);
  if (explicit) return canonicalizeDiscoveryProductType(explicit);
  const category = normalizeText(product.category);
  if (category === 'smartphones') return 'phone';
  if (category === 'laptops') return 'laptop';
  if (category === 'tablets') return 'tablet';
  return undefined;
}

function excludedTypesOf(intent: McpDiscoveryIntent) {
  return new Set((intent.excluded_product_types ?? []).map(normalizeText)
    .filter((value): value is string => Boolean(value)).map(canonicalizeDiscoveryProductType));
}

// Product-level identity is identical for every candidate of a row: type,
// brand, model, and compatibility never vary by option. An exclusion here is
// definitive even when option hydration failed, because no missing variant or
// offer could overturn verified product facts.
function evaluateAlternativeIdentity(
  product: Record<string, unknown>,
  discovery: Record<string, unknown>,
  alternative: DiscoveryAlternative,
  excludedTypes: Set<string>,
  productType: string | undefined
): IdentityVerdict {
  let unverified = false;
  if (excludedTypes.size > 0 && !productType) unverified = true;
  if (productType && excludedTypes.has(productType)) return { excluded: true, unverified };

  if (alternative.product_type !== undefined) {
    const expectedRaw = normalizeText(alternative.product_type);
    if (!expectedRaw) return { excluded: true, unverified };
    const expected = canonicalizeDiscoveryProductType(expectedRaw);
    if (!productType) unverified = true;
    else if (productType !== expected) return { excluded: true, unverified };
  }
  if (alternative.brands !== undefined) {
    const brand = normalizeText(product.brand);
    const allowedBrands = alternative.brands.map(normalizeText).filter((value): value is string => Boolean(value));
    if (!brand) unverified = true;
    else if (!allowedBrands.includes(brand)) return { excluded: true, unverified };
  }
  if (alternative.model !== undefined) {
    const model = normalizeText(discovery.model);
    const expected = normalizeText(alternative.model);
    if (!expected) return { excluded: true, unverified };
    if (!model) unverified = true;
    else if (model !== expected) return { excluded: true, unverified };
  }
  if (alternative.compatible_with !== undefined) {
    const compatibility = Array.isArray(discovery.compatible_with)
      ? discovery.compatible_with.map(normalizeText).filter((value): value is string => Boolean(value))
      : [];
    const expected = normalizeText(alternative.compatible_with);
    if (!expected) return { excluded: true, unverified };
    if (compatibility.length === 0) unverified = true;
    else if (!compatibility.includes(expected)) return { excluded: true, unverified };
  }
  return { excluded: false, unverified };
}

/** True when verified product facts rule out every alternative, so a failed
 * options lookup for this row cannot change the result and must not veto it. */
function isRowExcludedByIdentity(row: HydratedProduct, intent: McpDiscoveryIntent) {
  const product = row.product as Record<string, unknown>;
  const discovery = metadataOf(product);
  const excludedTypes = excludedTypesOf(intent);
  const productType = productTypeOf(product, discovery);
  return intent.alternatives.every((alternative) =>
    evaluateAlternativeIdentity(product, discovery, alternative, excludedTypes, productType).excluded);
}

/** Mirrors the PDP hasVariantConditionAxis: any variant with a normalized
 * condition owns the condition axis and disables condition offers entirely.
 * Shared by offer selection and the options-lookup veto so both callers
 * evaluate identical facts. */
function variantsOwnConditionAxis(product: Record<string, unknown>, variants: readonly unknown[] | undefined) {
  if (product.has_variants !== true) return false;
  return (variants ?? []).some((rawVariant) => {
    const variant = rawVariant !== null && typeof rawVariant === 'object' && !Array.isArray(rawVariant)
      ? rawVariant as Record<string, unknown> : {};
    const variantCondition = variant.condition;
    return normalizeCanonicalProductCondition(typeof variantCondition === 'string' ? variantCondition : null) !== '';
  });
}

/** Product-level structured identity: the shared verdict behind offer
 * selection and the options-lookup veto, kept in one module so both callers
 * evaluate identical facts. */
export const structuredDiscoveryIdentity = {
  evaluateAlternativeIdentity,
  excludedTypesOf,
  isRowExcludedByIdentity,
  metadataOf,
  normalizeText,
  productTypeOf,
  variantsOwnConditionAxis,
};
