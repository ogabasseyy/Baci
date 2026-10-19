import { describe, expect, it } from 'vitest';
import { STOREFRONT_CLUSTER_GUIDE_PENDING_SOURCES } from './supabase-history-replay-storefront-cluster-guide-pending-sources';

const MIGRATIONS = [
  '20260823152433_optimize_storefront_cluster_guide_classifier_core.sql',
  '20260823152435_optimize_storefront_cluster_guide_classifier_rpc.sql',
  '20260823160000_optimize_storefront_cluster_guide_classifier_category_core.sql',
  '20260823160001_optimize_storefront_cluster_guide_classifier_category_rpc.sql',
  '20260823163000_optimize_storefront_cluster_guide_classifier_ordered_core.sql',
  '20260823163001_optimize_storefront_cluster_guide_classifier_ordered_rpc.sql',
] as const;

describe('storefront cluster-guide replay sources', () => {
  it('keeps the classifier migration cohort complete and ordered', () => {
    const rows = STOREFRONT_CLUSTER_GUIDE_PENDING_SOURCES.trim().split('\n');

    expect(rows).toHaveLength(MIGRATIONS.length);
    expect(rows.map((row) => row.split(' ')[1])).toEqual([...MIGRATIONS]);
    for (const row of rows) {
      expect(row).toMatch(/^[0-9a-f]{64} 202\d{11}_[a-z0-9_]+\.sql$/);
    }
  });
});
