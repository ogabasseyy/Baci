import type { SupportedClusterCategory } from '@/lib/storefront-content/content-cluster-types';
import type { ClusterSupport } from './storefront-content-cluster-shared';
import { CORE_CONTENT_CLUSTER_SUPPORT } from './storefront-content-clusters-core';
import { GAMING_CONTENT_CLUSTER_SUPPORT } from './storefront-content-clusters-gaming';
import { MEDIA_CONTENT_CLUSTER_SUPPORT } from './storefront-content-clusters-media';

export const CONTENT_CLUSTER_SUPPORT = {
  ...CORE_CONTENT_CLUSTER_SUPPORT,
  ...GAMING_CONTENT_CLUSTER_SUPPORT,
  ...MEDIA_CONTENT_CLUSTER_SUPPORT,
} satisfies Record<SupportedClusterCategory, ClusterSupport>;

export const EXPLICIT_CONTENT_CLUSTER_CATEGORIES = (
  Object.entries(CONTENT_CLUSTER_SUPPORT) as [
    SupportedClusterCategory,
    ClusterSupport,
  ][]
)
  .flatMap(([categorySlug, support]) =>
    support.categoryNames.map((name) => ({ categorySlug, name }))
  )
  .sort((left, right) => right.name.length - left.name.length);

export const CONTENT_KIND_TOKENS = {
  'buyer-guide': [
    'buyer guide',
    'buying guide',
    'how to choose',
    'what to buy',
    'support article',
    'worth buying',
  ],
  'best-in-nigeria': ['best', 'top', 'nigeria', 'budget', 'affordable'],
  troubleshooting: [
    'fix',
    'troubleshoot',
    'problem',
    'issue',
    'repair',
    'why',
    'not working',
  ],
  'decision-support': [
    'vs',
    'versus',
    'compare',
    'comparison',
    'difference',
    'which',
    'alternative',
    'alternatives',
    'instead of',
    'what to buy instead',
    'what to buy next',
    'upgrade from',
    'moving on from',
  ],
} as const;

export const CONTENT_CLUSTER_SCORE = {
  categoryMatch: 4,
  kindMatch: 2,
  brandMatch: 2,
  priceBandMatch: 2,
  productTokenMatch: 2,
  titleTokenMatch: 1,
} as const;
