import { selectHydratedDiscoveryIntent } from './select-hydrated-discovery-intent';
import type { hydrateSearchProductAvailability } from './search-product-availability';

type HydratedProduct = Awaited<ReturnType<typeof hydrateSearchProductAvailability>>[number];

/** Match each available combination independently, never mixing option attributes. */
export function matchesHydratedDiscoveryIntent(row: HydratedProduct, query: string | undefined): boolean {
  return selectHydratedDiscoveryIntent(row, query) !== undefined;
}
