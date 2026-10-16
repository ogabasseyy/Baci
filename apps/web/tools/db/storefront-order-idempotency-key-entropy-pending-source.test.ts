import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('review fix: order idempotency key entropy migration in pending registry', () => {
  it('includes storefront_order_idempotency_key_entropy in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261016150000_storefront_order_idempotency_key_entropy.sql';
    const sha256 =
      'dfccd440b8b54152cd2a247553964b5db6f721be0d2203d4dfe4604636d55d4b';

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
