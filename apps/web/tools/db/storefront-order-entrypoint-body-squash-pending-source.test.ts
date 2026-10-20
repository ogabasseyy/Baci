import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: order entrypoint body squash migration in pending registry', () => {
  it('includes storefront_order_entrypoint_body_squash in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261020090000_storefront_order_entrypoint_body_squash.sql';
    const sha256 =
      '3ba96b2452996d1d4d1e88e27acd9a34b22abc3c4f6db0ade5e5ee5bc65a0141';

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
