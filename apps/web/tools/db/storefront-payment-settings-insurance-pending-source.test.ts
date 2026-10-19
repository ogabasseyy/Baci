import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('bugfix: payment-settings insurance migration missing from pending registry', () => {
  it('includes storefront_payment_settings_shipping_insurance in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261015090001_storefront_payment_settings_shipping_insurance.sql';
    const sha256 =
      '5d563615e5bc1d14623f18f69f6c714bf818da85d1e89a9d485fc774f3cce8f3';

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
