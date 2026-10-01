import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260821180006_provider_neutral_ads_oauth_state_nonces.sql'
);
const hardeningMigration = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260821180007_harden_provider_neutral_ads_oauth_state_nonce_rpcs.sql'
);

describe('provider-neutral Ads OAuth nonce migration', () => {
  it('binds one-time Google, Meta, and TikTok nonces to the caller and callback', () => {
    const sql = readFileSync(migration, 'utf8').toLowerCase();

    expect(sql).toContain("'google_ads', 'meta_ads', 'tiktok_ads'");
    expect(sql).toContain('reserve_merchant_ads_oauth_state_nonce');
    expect(sql).toContain('consume_merchant_ads_oauth_state_nonce');
    expect(sql).toContain('auth.uid() is distinct from p_user_id');
    expect(sql).toContain("'integrations', 'manage'");
    expect(sql).toContain('redirect_uri = p_redirect_uri');
    expect(sql).toContain('p_redirect_uri <> (case p_provider');
    expect(sql).toContain('expires_at > pg_catalog.now()');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('revoke all on function');
    expect(sql).toContain('grant execute');
  });

  it('fails closed instead of relying on SQL null semantics for RPC inputs', () => {
    const sql = readFileSync(hardeningMigration, 'utf8').toLowerCase();

    expect(sql).toContain('p_provider is null');
    expect(sql).toContain('p_merchant_id is null');
    expect(sql).toContain('p_user_id is null');
    expect(sql).toContain('p_nonce is null');
    expect(sql).toContain('p_redirect_uri is null');
    expect(sql).toContain('p_expires_at is null');
  });
});
