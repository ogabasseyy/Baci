import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: order entrypoint body squash migration in pending registry', () => {
  it('includes storefront_order_entrypoint_body_squash in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261020090000_storefront_order_entrypoint_body_squash.sql';
    const sha256 =
      '35d90f8b7c138d20a4bd4bca54f6c18a76f2e7951da8a2769a3b02fe3cfa1fa2';

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
