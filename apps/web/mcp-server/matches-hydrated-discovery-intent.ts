import { matchesDiscoveryProductIntent } from './matches-discovery-product-intent';
import type { hydrateSearchProductAvailability } from './search-product-availability';
import { words } from './matches-discovery-product-intent-words';

type HydratedProduct = Awaited<ReturnType<typeof hydrateSearchProductAvailability>>[number];

/** Match each available combination independently, never mixing option attributes. */
export function matchesHydratedDiscoveryIntent(
  { product, availableVariants, variantAttributeValues }: HydratedProduct,
  query: string | undefined
): boolean {
  if (!product.has_variants) return matchesDiscoveryProductIntent(product, query);
  const optionWords = new Set(variantAttributeValues.flatMap((value) => words(String(value))));
  const invariantText = (text: string | null | undefined) =>
    words(text ?? '').filter((word) => !optionWords.has(word)).join(' ');
  const invariantProduct = { ...product, name: invariantText(product.name), description: invariantText(product.description) };
  if (matchesDiscoveryProductIntent(invariantProduct, query)) return true;
  return availableVariants.some((variant) => {
    const attributes = Object.entries(variant.attributes ?? {})
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
      .map(([key, value]) => `${String(value)} ${key}`)
      .join(' ');
    return matchesDiscoveryProductIntent({
      ...invariantProduct,
      description: `${attributes} ${invariantProduct.description}`,
    }, query);
  });
}
