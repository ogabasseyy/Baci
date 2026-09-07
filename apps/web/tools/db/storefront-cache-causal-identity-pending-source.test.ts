import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('bugfix: causal cache identity migration missing from pending registry', () => {
  it('includes share_storefront_cache_invalidation_causal_identity in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20260905183000_share_storefront_cache_invalidation_causal_identity.sql';
    const sha256 =
      'e87f8b3e8fecf098cc148d4efc75c75f62a96e0b4bdc98cdb904a91157a33c42';

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
