import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..'
);
const CACHED_DATA_SOURCE = readFileSync(
  join(REPOSITORY_ROOT, 'apps/web/src/lib/cached-data.ts'),
  'utf8'
);
const MIGRATION_SOURCE = readFileSync(
  join(
    REPOSITORY_ROOT,
    'supabase/migrations/20260727150000_exact_product_and_feature_cache_invalidation.sql'
  ),
  'utf8'
);

describe('cache invalidation feature projection', () => {
  it('reads public feature settings through the snapshot RPC, never the base table', () => {
    // Production revokes anonymous SELECT on the secret-bearing
    // merchant_feature_settings table, so the cached read must go through
    // the SECURITY DEFINER snapshot projection.
    expect(CACHED_DATA_SOURCE).toContain(
      'resolve_storefront_public_snapshot_v2'
    );
    expect(CACHED_DATA_SOURCE).not.toMatch(
      /\.from\('merchant_feature_settings'\)/
    );
  });

  it('tracks only the custom settings published by the public snapshot', () => {
    for (const key of [
      'google_merchant_id',
      'google_store_widget_enabled',
      'paypal_enabled',
      'paypal_mode',
    ]) {
      expect(MIGRATION_SOURCE).toContain(`'${key}'`);
    }

    expect(MIGRATION_SOURCE).not.toContain("'facebook_capi_token'");
    expect(MIGRATION_SOURCE).not.toContain("'paypal_client_secret'");
  });
});
