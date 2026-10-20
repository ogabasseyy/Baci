import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: replay key floor migration in pending registry', () => {
  it('includes storefront_order_replay_key_floor in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261016100000_storefront_order_replay_key_floor.sql';
    const sha256 =
      '35bb3fc0bca3a6e133e1909c7dc53179709819abf734ae6ae573f8a505709039';

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
