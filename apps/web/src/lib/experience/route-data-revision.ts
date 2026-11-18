import { cache } from 'react';
import { loadPublishedExperience } from './published-manifest';
import { getExperienceStorefrontRuntime } from './storefront-runtime';

const resolveBoundary = cache(
  async (id: string, slug: string | null, path: string) => {
    const merchant = { id, slug };
    const runtime = getExperienceStorefrontRuntime();
    if (!runtime) return null;
    const manifest = await loadPublishedExperience(merchant);
    if (!manifest) return null;
    const boundary = await runtime.resolveBoundary(merchant, path);
    if (
      !boundary ||
      boundary.manifest.merchantId !== merchant.id ||
      boundary.manifest.buildDigest !== manifest.buildDigest ||
      boundary.manifest.policyRevision !== manifest.policyRevision ||
      boundary.bootstrap.route.publicDataRevision !==
        boundary.bootstrap.catalog.revision
    )
      return null;
    return boundary;
  }
);
export function resolveExperienceBoundary(
  merchant: { id: string; slug?: string | null },
  path: string
) {
  return resolveBoundary(merchant.id, merchant.slug ?? null, path);
}
export function selectTrustedExperienceCheckout(
  merchant: { template_id?: string | null },
  experience: unknown
): 'engine' | 'legacy-demo' {
  return experience || merchant.template_id !== 'new-template'
    ? 'engine'
    : 'legacy-demo';
}
