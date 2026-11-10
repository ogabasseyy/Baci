import type {
  ExperienceCapability,
  PublicBootstrap,
  PublicCatalog,
  RouteState,
} from '@baci/shared/experience';
import { assertPublicResponseBudget } from './public-response-budget';
export function buildPublicBootstrap(
  route: RouteState,
  catalog: PublicCatalog,
  capabilities: ExperienceCapability[],
  currency?: string
): PublicBootstrap {
  const bootstrap: PublicBootstrap = {
    ...(currency ? { currency } : {}),
    route: {
      epoch: route.epoch,
      routeId: route.routeId,
      canonicalPath: route.canonicalPath,
      params: { ...route.params },
      publicDataRevision: catalog.revision,
    },
    catalog: {
      products: catalog.products.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        price: p.price,
        currency: p.currency,
        image: p.image ? { assetId: p.image.assetId, alt: p.image.alt } : null,
        variants: p.variants.map((v) => ({
          id: v.id,
          label: v.label,
          available: v.available,
          ...(v.price === undefined ? {} : { price: v.price }),
        })),
        available: p.available,
        canonicalPath: p.canonicalPath,
        requiresVariant: p.requiresVariant,
      })),
      revision: catalog.revision,
    },
    capabilities: [...new Set(capabilities)],
  };
  assertPublicResponseBudget(bootstrap);
  return bootstrap;
}
