import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260821180004_snapchat_ads_oauth_and_disconnect.sql'
);
const refreshMigration = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260821180005_snapchat_ads_atomic_refresh_tokens.sql'
);
const refreshStateMigration = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260827110300_restore_snapchat_refresh_state.sql'
);

describe('Snapchat Ads security migration', () => {
  it('atomically consumes OAuth nonces and deletes spend before its connection', () => {
    const sql = readFileSync(migration, 'utf8').toLowerCase();
    expect(sql).toContain(
      'create table if not exists public.merchant_ads_oauth_state_nonces'
    );
    expect(sql).toContain('delete from public.merchant_ads_oauth_state_nonces');
    expect(sql).toContain('delete from public.merchant_ad_spend_daily');
    expect(sql).toContain('delete from public.merchant_ad_connections');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('enable row level security');
  });

  it('uses a compare-and-swap update to persist replacement refresh tokens', () => {
    const sql = readFileSync(refreshMigration, 'utf8').toLowerCase();
    expect(sql).toContain('update_snapchat_ads_connection_tokens');
    expect(sql).toContain(
      'refresh_token_ciphertext = p_refresh_token_ciphertext'
    );
    expect(sql).toContain(
      'refresh_token_ciphertext = p_current_refresh_token_ciphertext'
    );
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('grant execute');
  });

  it('clears a stale reauth marker when the refresh-token CAS succeeds', () => {
    const sql = readFileSync(refreshStateMigration, 'utf8').toLowerCase();
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("metadata - 'reauthrequired' - 'reauthreason'");
    expect(sql).toContain("attribution_metadata - 'reauthrequired'");
    expect(sql).toContain(
      'refresh_token_ciphertext = p_current_refresh_token_ciphertext'
    );
    expect(sql).toContain('grant execute');
  });
});
