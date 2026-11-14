import { resolveCatalogExperienceRoute } from '@/lib/experience/catalog-route-ownership';
import {
  isCategorizedExperienceProductPath,
  normalizeExperiencePath,
  resolveExperienceRoute,
} from '@/lib/experience/route-ownership';
import { readExperienceCatalog } from './experience-launch-client';
import type { ExperienceShellState } from './experience-shell-controller';

/** Resolve via the normal public catalog without navigating or changing shell state. */
export async function resolveHostDestination(
  s: ExperienceShellState,
  requestedPath: string,
  current: () => ExperienceShellState | null
) {
  const path = normalizeExperiencePath(requestedPath);
  const route = resolveExperienceRoute(s.data.manifest.routes, path);
  let products = s.data.bootstrap.catalog.products;
  const handle =
    route?.view === 'product'
      ? route.params.handle
      : isCategorizedExperienceProductPath(path)
        ? path.split('/')[2]
        : /^\/products\/[a-z0-9-]+$/.test(path)
          ? path.split('/')[2]
          : null;
  let product = products.find(
    (p) => p.canonicalPath === path || (handle && p.slug === handle)
  );
  if (
    !product &&
    handle &&
    s.data.manifest.capabilities?.includes('catalog.read')
  ) {
    const result = await readExperienceCatalog(s.data.stateUrl, {
      productSlug: handle,
    });
    if (current() !== s || !s.active) throw Error('INVALID_ROUTE');
    product = result.products.find((p) => p.slug === handle);
    if (product) products = [...products, product];
  }
  if (!route && !product) throw Error('INVALID_ROUTE');
  const destination = normalizeExperiencePath(product?.canonicalPath ?? path);
  const owned = resolveCatalogExperienceRoute(
    s.data.manifest.routes,
    destination,
    products
  );
  return { destination, owned };
}
