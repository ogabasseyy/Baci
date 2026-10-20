import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: search condition hyphen migration in pending registry', () => {
  it('includes search_condition_match_hyphen in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261016090000_search_condition_match_hyphen.sql';
    const sha256 =
      '82e8ab798c5444cfcc1037f21bfb376940d15ae7801f0462efa12f32bde0b274';

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
