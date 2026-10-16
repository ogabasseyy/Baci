import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: offer identity hardening migrations in pending registry', () => {
  it.each([
    {
      repositoryPath:
        'supabase/migrations/20261016120000_storefront_order_item_offer_identity_hardening.sql',
      sha256:
        'efb4ed9615d183d01155ab7ceedf1509228afb85a4d15e6adc8da80ff3e75e26',
    },
    {
      repositoryPath:
        'supabase/migrations/20261016130000_storefront_order_replay_economics_offer_snapshot.sql',
      sha256:
        '3e4ef56adae86434136c65c4c19e63c1ab04c2a62e4316ad0cbec1f77222b4e7',
    },
    {
      repositoryPath:
        'supabase/migrations/20261016140000_storefront_order_item_offer_identity_freeze.sql',
      sha256:
        'bff7b2dbb638298f1a0c464506bc23a5de3af1c5a0ab0ea9b9cf7e88f99f4bb0',
    },
  ])('includes $repositoryPath in pending sources', (source) => {
    expect(EXPECTED_PENDING_SOURCES).toContainEqual(source);
    expect(supabaseHistoryReplayManifest.pendingSources).toContainEqual(source);
  });
});
