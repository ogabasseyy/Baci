import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import { performancePublicBootstrap } from '@/schemas/experience-performance-worker';
import { resolveExperienceRoute } from './route-resolver';
export async function validatePerformanceBootstrap(
  raw: PublicBootstrap,
  manifest: ExperienceManifest,
  view: ExperienceManifest['routes'][number]['view']
) {
  const bootstrap = performancePublicBootstrap.parse(raw);
  const result = await resolveExperienceRoute(
    manifest.routes,
    bootstrap.route.canonicalPath,
    {
      product: (handle) => {
        const p = bootstrap.catalog.products.find((p) => p.slug === handle);
        return Promise.resolve(
          p
            ? {
                id: p.id,
                canonicalPath: p.canonicalPath ?? `/products/${p.slug}`,
              }
            : null
        );
      },
      collection: async () => ({ id: bootstrap.route.params.handle ?? '' }),
    }
  );
  const match = result.kind === 'route' ? result.route : null;
  if (
    !match ||
    match.view !== view ||
    Object.values(match.params).some((value) => !value.trim()) ||
    (view === 'product' &&
      !bootstrap.catalog.products.some(
        (product) =>
          product.slug === match.params.handle &&
          (!product.canonicalPath ||
            product.canonicalPath === bootstrap.route.canonicalPath)
      ))
  )
    throw Error('INVALID_ROUTE');
  return bootstrap;
}
