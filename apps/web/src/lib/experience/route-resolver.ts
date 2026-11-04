import type { ExperienceManifest } from '@baci/shared/experience';
import {
  isCategorizedExperienceProductPath,
  resolveExperienceRoute as matchRoute,
  normalizeExperiencePath,
} from './route-ownership';

interface ProductResolution {
  id: string;
  canonicalPath: string;
}
export async function resolveExperienceRoute(
  routes: ExperienceManifest['routes'],
  path: string,
  deps: {
    product: (
      handle: string,
      path: string
    ) => Promise<ProductResolution | null>;
    collection: (handle: string) => Promise<{ id: string } | null>;
  }
) {
  let normalized: string;
  try {
    normalized = normalizeExperiencePath(path);
  } catch {
    return { kind: 'not-found' as const };
  }
  let route = matchRoute(routes, normalized);
  // Category/PDP ownership stays with the existing product resolver, never the
  // authored wildcard. Static/auth/checkout routes are excluded before lookup.
  if (
    !route &&
    isCategorizedExperienceProductPath(normalized) &&
    routes.some((r) => r.view === 'product')
  ) {
    const product = await deps.product(normalized.split('/')[2], normalized);
    if (product) {
      if (product.canonicalPath !== normalized)
        return { kind: 'redirect' as const, location: product.canonicalPath };
      route = {
        view: 'product',
        canonicalPath: normalized,
        params: { handle: normalized.split('/')[2] },
      };
    }
  }
  if (!route) return { kind: 'not-found' as const };
  if (route.view === 'product') {
    const product = await deps.product(route.params.handle, normalized);
    if (!product) return { kind: 'not-found' as const };
    if (product.canonicalPath !== normalized)
      return { kind: 'redirect' as const, location: product.canonicalPath };
    return { kind: 'route' as const, route, productId: product.id };
  }
  if (
    route.view === 'collection' &&
    !(await deps.collection(route.params.handle))
  )
    return { kind: 'not-found' as const };
  return { kind: 'route' as const, route };
}
