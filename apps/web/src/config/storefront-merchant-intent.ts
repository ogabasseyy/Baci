import type { ContentClusterKind } from '@/lib/storefront-content/content-cluster-types';

export const VALID_MERCHANT_INTENT_SOURCES = new Set([
  'merchant_declared',
  'verified_receipt',
  'reviewed',
] as const);

export const MERCHANT_INTENT_CLUSTER_KIND_MAP: Record<
  string,
  ContentClusterKind | null
> = {
  comparison: 'decision-support',
  'repair-guide': 'troubleshooting',
  news: null,
};
