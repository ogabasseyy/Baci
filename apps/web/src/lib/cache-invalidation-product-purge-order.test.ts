import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const orderedPurgeMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260727184356_enforce_ordered_exact_cache_and_membership_ownership.sql'
  ),
  'utf8'
);

describe('ordered product purge contract', () => {
  it('enqueues a generation-fenced broad purge only after exact product invalidation succeeds', () => {
    expect(orderedPurgeMigration).toMatch(
      /v_updated_merchant_id IS NOT NULL[\s\S]*p_succeeded[\s\S]*p_target_kind = 'storefront_product'[\s\S]*enqueue_storefront_cache_targets\(v_updated_merchant_id\)/
    );
    expect(orderedPurgeMigration).toContain(
      'outbox.claimed_generation = p_generation'
    );
    expect(orderedPurgeMigration).toContain(
      'outbox.claim_token = p_claim_token'
    );
  });
});
