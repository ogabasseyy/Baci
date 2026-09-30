import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { matchesDiscoveryProductIntent } from './matches-discovery-product-intent';
import type { hydrateSearchProductAvailability } from './search-product-availability';
import { words } from './matches-discovery-product-intent-words';
import { getMcpProductStockSummary } from './product-stock-summary';

type HydratedProduct = Awaited<ReturnType<typeof hydrateSearchProductAvailability>>[number];

/** Preserve the available combination that satisfies the query when pricing it. */
export function selectHydratedDiscoveryIntent(row: HydratedProduct, query: string | undefined): HydratedProduct | undefined {
  const { product, availableVariants, variantAttributeValues } = row;
  if (!product.has_variants) return matchesDiscoveryProductIntent(product, query) ? row : undefined;
  const optionWords = new Set(variantAttributeValues.flatMap((value) => words(String(value))));
  const queryWords = words(query ?? '');
  const enforceOption = queryWords.length === 1 && optionWords.has(queryWords[0]);
  const invariantText = (text: string | null | undefined) =>
    words(text ?? '').filter((word) => !optionWords.has(word)).join(' ');
  const invariantProduct = { ...product, name: invariantText(product.name), description: invariantText(product.description) };
  if (matchesDiscoveryProductIntent(invariantProduct, query, enforceOption)) return row;
  const matchingVariants = availableVariants.filter((variant) => {
    const attributes = Object.entries(variant.attributes ?? {})
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
      .map(([key, value]) => `${String(value)} ${key}`).join(' ');
    return matchesDiscoveryProductIntent({ ...invariantProduct,
      description: `${attributes} ${invariantProduct.description}`,
    }, query, enforceOption);
  });
  if (matchingVariants.length === 0) return undefined;
  const cheapest = matchingVariants.map((variant) => ({
    price: variant.price_override ?? product.price,
    condition: normalizeCanonicalProductCondition(variant.condition ??
      (typeof variant.attributes?.condition === 'string' ? variant.attributes.condition : null)) || row.displayCondition,
  })).filter((option): option is { price: number; condition: typeof row.displayCondition } =>
    typeof option.price === 'number' && Number.isFinite(option.price) && option.price >= 0)
    .sort((left, right) => left.price - right.price)[0];
  return { ...row, availableVariants: matchingVariants,
    stockSummary: getMcpProductStockSummary(product, matchingVariants, []),
    displayPrice: cheapest?.price ?? null,
    displayCondition: cheapest?.condition ?? row.displayCondition,
    displayCompareAtPrice: cheapest?.price === product.price ? product.compare_at_price : null };
}
