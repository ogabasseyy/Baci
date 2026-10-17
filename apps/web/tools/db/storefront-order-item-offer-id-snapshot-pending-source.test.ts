import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: offer-id snapshot migration in pending registry', () => {
  it('includes storefront_order_item_offer_id_snapshot in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261016110000_storefront_order_item_offer_id_snapshot.sql';
    const sha256 =
      '35e6dc838033f09f69ed12d479988833a9d6dbfe0b41905093998584eac0ae18';

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
