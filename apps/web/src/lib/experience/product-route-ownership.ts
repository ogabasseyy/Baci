import type { ExperienceManifest } from '@baci/shared/experience';
import { resolveExperienceRoute } from './route-resolver';
/** Native PDP resolution establishes the product and canonical path first. */
export async function experienceOwnsProductRoute(
  routes: ExperienceManifest['routes'],
  canonicalPath: string,
  productSlug: string
) {
  const result = await resolveExperienceRoute(routes, canonicalPath, {
    product: async (handle) =>
      handle === productSlug ? { id: productSlug, canonicalPath } : null,
    collection: async () => null,
  });
  return result.kind === 'route' && result.route.view === 'product';
}
