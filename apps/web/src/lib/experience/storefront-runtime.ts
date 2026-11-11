import type { PublicBootstrap, PublicCatalog } from '@baci/shared/experience';
import type { ExperienceFrameLaunch } from '@/components/storefront/experience/experience-frame-types';
import type { PublishedManifest } from './published-manifest';
export interface ExperienceBoundaryData {
  manifest: PublishedManifest;
  bootstrap: PublicBootstrap;
  launch: ExperienceFrameLaunch;
  stateUrl: string;
  title: string;
  canonicalUrl: string;
}
export interface ExperienceStorefrontRuntime {
  snapshot?(
    merchant: { id: string; slug?: string | null },
    data: ExperienceBoundaryData
  ): Promise<import('./snapshot-freshness').ExperienceSnapshot | null>;
  loadPublishedManifest(merchant: {
    id: string;
    slug?: string | null;
  }): Promise<unknown | null>;
  resolveBoundary(
    merchant: { id: string; slug?: string | null },
    path: string
  ): Promise<ExperienceBoundaryData | null>;
  catalog(
    merchant: { id: string; slug?: string | null },
    selection: { handle?: string; productSlug?: string; productId?: string }
  ): Promise<PublicCatalog | null>;
  state(
    merchant: { id: string; slug: string },
    buildDigest: string,
    path?: string
  ): Promise<{
    active: boolean;
    policyRevision: string;
    catalogRevision: string;
  }>;
}
const key = Symbol.for('baci.local-experience-storefront-runtime');
const holder = globalThis as typeof globalThis & {
  [key]?: ExperienceStorefrontRuntime;
};
export function getExperienceStorefrontRuntime() {
  return holder[key] ?? null;
}
export function installExperienceStorefrontRuntime(
  runtime: ExperienceStorefrontRuntime
) {
  if (holder[key]) throw Error('ALREADY_INSTALLED');
  holder[key] = runtime;
  return () => {
    if (holder[key] === runtime) delete holder[key];
  };
}
