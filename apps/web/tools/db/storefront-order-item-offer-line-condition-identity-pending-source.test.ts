import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: offer line condition identity migration in pending registry', () => {
  it('includes storefront_order_item_offer_line_condition_identity in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261019100000_storefront_order_item_offer_line_condition_identity.sql';
    const sha256 =
      'e2a9e1c01d2e137e3b198752c4310999b88ffd5cde4ac96714f2218a600f649d';

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
