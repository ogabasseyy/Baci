import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: order offer tenant bind migration in pending registry', () => {
  it('includes storefront_order_item_offer_tenant_bind in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261016160000_storefront_order_item_offer_tenant_bind.sql';
    const sha256 =
      '8b78693d6a9d1a9ab76c23d667795f435d2f6eaf1fda34fecd2620d05014262d';

    expect(EXPECTED_PENDING_SOURCES).toContainEqual({
      repositoryPath,
      sha256,
    });
    expect(supabaseHistoryReplayManifest.pendingSources).toContainEqual({
      repositoryPath,
      sha256,
    });
  });
});
