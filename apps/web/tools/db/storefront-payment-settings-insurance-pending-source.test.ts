import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('bugfix: payment-settings insurance migration missing from pending registry', () => {
  it('includes storefront_payment_settings_shipping_insurance in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261015090000_storefront_payment_settings_shipping_insurance.sql';
    const sha256 =
      '7a2f5802a4b8292b23474ab09075a23add4e65c02b3b46e7a9fc1d211ad61229';

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
