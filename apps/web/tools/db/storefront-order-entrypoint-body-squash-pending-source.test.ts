import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: order entrypoint body squash migration in pending registry', () => {
  it('includes storefront_order_entrypoint_body_squash in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261020090000_storefront_order_entrypoint_body_squash.sql';
    const sha256 =
      '3f3b5e364940c5d70a69eecae172f359bbcf191e984b62d0f16ee25cb0d97488';

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
