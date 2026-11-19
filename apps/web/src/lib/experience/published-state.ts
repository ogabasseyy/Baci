import type { PublicCatalog } from '@baci/shared/experience';
import { experienceCatalogRevision } from './catalog-revision';
import type { PublishedManifest } from './published-manifest';
/** Public state only: immutable head/route/capability identity, never owner/source data. */
export function readPublishedExperienceState(input: {
  head: PublishedManifest | null;
  catalog: PublicCatalog | null;
  enrolled: boolean;
  requestedBuild: string;
}) {
  const { head, catalog, enrolled, requestedBuild } = input;
  const active =
    !!head && head.buildDigest === requestedBuild && !!catalog && enrolled;
  return {
    active,
    status: active
      ? ('active' as const)
      : head
        ? ('unavailable' as const)
        : ('unpublished' as const),
    buildDigest: head?.buildDigest ?? null,
    publicationRevision: head?.policyRevision ?? '',
    policyRevision: head?.policyRevision ?? '',
    routeMapDigest: head
      ? experienceCatalogRevision('routes', head.routes)
      : '',
    capabilityRevision: head
      ? experienceCatalogRevision('capabilities', [head.capabilities, enrolled])
      : '',
    catalogRevision: catalog?.revision ?? '',
  };
}
