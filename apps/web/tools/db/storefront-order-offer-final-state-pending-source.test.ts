import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: order offer final state migration in pending registry', () => {
  it('includes storefront_order_offer_final_state in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261019090000_storefront_order_offer_final_state.sql';
    const sha256 =
      'b804e2f56ee988be072063735e81ca669c5af5c0fb6e12c2b62900aca8fcc582';

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
