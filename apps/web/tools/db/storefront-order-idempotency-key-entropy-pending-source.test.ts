import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: order idempotency key entropy migration in pending registry', () => {
  it('includes storefront_order_idempotency_key_entropy in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261016150000_storefront_order_idempotency_key_entropy.sql';
    const sha256 =
      'fb28c5d4994866dae1e83003b49d3ecfcd4d332b6f0d7a26b8b418c3f130fd21';

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
