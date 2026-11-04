import type {
  ExperienceManifest,
  PublicProduct,
} from '@baci/shared/experience';
import {
  normalizeExperiencePath,
  resolveExperienceRoute,
} from './route-ownership';
/** Catalog membership establishes canonical product identity, never authored ownership. */
export function resolveCatalogExperienceRoute(
  routes: ExperienceManifest['routes'],
  path: string,
  products: readonly Pick<PublicProduct, 'slug' | 'canonicalPath'>[]
) {
  const route = resolveExperienceRoute(routes, path);
  if (route) return route;
  if (!routes.some((route) => route.view === 'product')) return null;
  try {
    normalizeExperiencePath(path);
  } catch {
    return null;
  }
  const product = products.find((product) => product.canonicalPath === path);
  if (
    !product ||
    !/^\/(?!pages\/|api\/|account\/|auth\/|checkout\/|blog\/)[a-z0-9-]+\/[a-z0-9-]+$/.test(
      path
    )
  )
    return null;
  return {
    view: 'product' as const,
    canonicalPath: path,
    params: { handle: product.slug },
  };
}
