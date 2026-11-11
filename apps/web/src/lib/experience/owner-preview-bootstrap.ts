import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from './authorization';
import { loadOwnerPreviewCatalog } from './catalog-adapter';
import { buildPublicBootstrap } from './public-bootstrap';
import { resolveExperienceRoute } from './route-resolver';

/** Build a private preview using only the requesting owner's RLS-scoped catalog. */
export async function loadOwnerPreviewBootstrap(
  ctx: OwnerRequestContext,
  manifest: ExperienceManifest,
  routeId: string
): Promise<PublicBootstrap> {
  const selected = manifest.routes.find(
    (route) => route.path === routeId || route.view === routeId
  );
  if (!selected) throw Error('NOT_FOUND');
  const data = await loadOwnerPreviewCatalog(ctx, {});
  if (!data) throw Error('CATALOG_UNAVAILABLE');
  const { catalog, currency } = data;
  const product = catalog.products[0];
  const path =
    selected.view === 'collection'
      ? '/collections/all'
      : selected.view === 'product'
        ? (product?.canonicalPath ??
          (product ? `/products/${product.slug}` : null))
        : selected.path;
  if (!path) throw Error('NOT_FOUND');
  const resolved = await resolveExperienceRoute(manifest.routes, path, {
    product: (handle) => {
      const found = catalog.products.find((item) => item.slug === handle);
      return Promise.resolve(
        found
          ? {
              id: found.id,
              canonicalPath: found.canonicalPath ?? `/products/${found.slug}`,
            }
          : null
      );
    },
    collection: async (handle) => (handle === 'all' ? { id: 'all' } : null),
  });
  if (resolved.kind !== 'route' || resolved.route.view !== selected.view)
    throw Error('NOT_FOUND');
  await requireExperienceOwner(ctx, 'storefront.read');
  return buildPublicBootstrap(
    {
      epoch: 1,
      routeId: resolved.route.view,
      canonicalPath: resolved.route.canonicalPath,
      params: resolved.route.params,
      publicDataRevision: catalog.revision,
    },
    catalog,
    manifest.capabilities,
    currency
  );
}
