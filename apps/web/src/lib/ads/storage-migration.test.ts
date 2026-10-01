import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260821180000_provider_neutral_ads_storage.sql'
);
const hardeningMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260821180001_harden_provider_neutral_ads_rpcs.sql'
);
const spendWindowMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260824090000_replace_social_ads_spend_window.sql'
);
const accountAwareSyncMarkerMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260824110000_account_aware_ads_sync_marker.sql'
);
const syncStartedMarkerMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260827030001_mark_ads_sync_started.sql'
);
const nullReauthCasMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260827040001_allow_null_ads_reauth_cas.sql'
);
const syncRunFenceMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260827120001_fence_ads_sync_runs.sql'
);
const syncReplacementFenceMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260827120100_fence_ads_spend_replacements.sql'
);
const syncRunStartOrderMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260827120200_order_ads_sync_run_starts.sql'
);
const serverOwnedSyncRunMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260828010000_server_owned_ads_sync_runs.sql'
);
const syncWindowCompletionMigrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260828100000_ads_sync_window_completion.sql'
);

describe('provider-neutral ads storage migration', () => {
  it('extends the Google-only checks without replacing the Google migrations', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

    expect(sql).toContain(
      'drop constraint if exists merchant_ad_connections_provider_check'
    );
    expect(sql).toContain(
      "'google_ads', 'meta_ads', 'tiktok_ads', 'snapchat_ads'"
    );
    expect(sql).toContain('spend_amount_decimal numeric(30, 9)');
    expect(sql).toContain('account_timezone text');
    expect(sql).toContain('attribution_metadata jsonb');
  });

  it('keeps ciphertext denied to normal selects and RPCs permission bounded', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

    expect(sql).toContain('get_merchant_ads_connection_secret');
    expect(sql).toContain('security definer');
    expect(sql).toContain("'integrations', 'manage'");
    expect(sql).toContain(
      'revoke all on table public.merchant_ad_connections from authenticated'
    );
    expect(sql).toContain('grant select (');
    expect(sql).not.toContain(
      'access_token_ciphertext,\n  refresh_token_ciphertext'
    );
    expect(sql).toContain('upsert_merchant_ads_spend_daily');
  });

  it('reserves Google v1 storage for its legacy RPCs and locks new RPC paths', () => {
    const sql = readFileSync(hardeningMigrationPath, 'utf8').toLowerCase();

    expect(sql).toContain(
      "p_provider not in ('meta_ads', 'tiktok_ads', 'snapchat_ads')"
    );
    expect(sql).toContain("set search_path = ''");
    expect(sql).not.toContain('set search_path = public, pg_temp');
    expect(sql).toContain('pg_catalog.jsonb_typeof');
    expect(sql).toContain('pg_catalog.btrim');
  });

  it('atomically replaces a social provider window before applying fresh rows', () => {
    const sql = readFileSync(spendWindowMigrationPath, 'utf8').toLowerCase();

    expect(sql).toContain(
      'create or replace function public.replace_merchant_ads_spend_daily_window'
    );
    expect(sql).toContain('delete from public.merchant_ad_spend_daily');
    expect(sql).toContain('spend_date between p_start_date and p_end_date');
    expect(sql).toContain('public.upsert_merchant_ads_spend_daily');
    expect(sql).toContain('grant execute on function');
    expect(sql).toContain("'meta_ads', 'tiktok_ads', 'snapchat_ads'");
  });

  it('marks only the still-selected active provider account as synced', () => {
    const sql = readFileSync(
      accountAwareSyncMarkerMigrationPath,
      'utf8'
    ).toLowerCase();

    expect(sql).toContain(
      'create or replace function public.mark_merchant_ads_connection_synced_if_current'
    );
    expect(sql).toContain("and status = 'active'");
    expect(sql).toContain(
      'and provider_customer_id = pg_catalog.btrim(p_provider_customer_id)'
    );
    expect(sql).toContain("'google_ads'");
    expect(sql).toContain("'meta_ads'");
    expect(sql).toContain("'tiktok_ads'");
    expect(sql).toContain("'snapchat_ads'");
    expect(sql).toContain('return found');
  });

  it('clears freshness before an authenticated spend replacement begins', () => {
    const sql = readFileSync(
      syncStartedMarkerMigrationPath,
      'utf8'
    ).toLowerCase();

    expect(sql).toContain(
      'create or replace function public.mark_merchant_ads_connection_sync_started_if_current'
    );
    expect(sql).toContain('set last_synced_at = null');
    expect(sql).toContain("and status = 'active'");
    expect(sql).toContain(
      'and provider_customer_id = pg_catalog.btrim(p_provider_customer_id)'
    );
    expect(sql).toContain('from public, anon');
    expect(sql).toContain(
      'grant execute on function public.mark_merchant_ads_connection_sync_started_if_current'
    );
    expect(sql).toContain('to authenticated, service_role');
  });

  it('marks missing social credentials for reauthorization with a null-safe CAS', () => {
    const sql = readFileSync(nullReauthCasMigrationPath, 'utf8').toLowerCase();

    expect(sql).toContain(
      'create or replace function public.mark_merchant_ads_connection_reauth_if_current'
    );
    expect(sql).toContain('p_access_token_ciphertext is not null');
    expect(sql).toContain(
      'access_token_ciphertext is not distinct from p_access_token_ciphertext'
    );
    expect(sql).toContain(
      'refresh_token_ciphertext is not distinct from p_refresh_token_ciphertext'
    );
    expect(sql).toContain('ads_credential_rpc_authorized(p_merchant_id)');
    expect(sql).toContain(
      'revoke all on function public.mark_merchant_ads_connection_reauth_if_current'
    );
    expect(sql).toContain(
      'grant execute on function public.mark_merchant_ads_connection_reauth_if_current'
    );
    expect(sql).toContain('to service_role');
  });

  it('fences every replacement and freshness marker to one refresh run', () => {
    const sql = readFileSync(syncRunFenceMigrationPath, 'utf8').toLowerCase();
    const replacementSql = readFileSync(
      syncReplacementFenceMigrationPath,
      'utf8'
    ).toLowerCase();

    expect(sql).toContain(
      'add column if not exists sync_run_id pg_catalog.uuid'
    );
    expect(replacementSql).toContain('and c.sync_run_id = p_sync_run_id');
    expect(replacementSql).toContain('for update');
    expect(sql).toContain(
      'create or replace function public.mark_merchant_ads_connection_sync_started_if_current('
    );
    expect(sql).toContain(
      'create or replace function public.mark_merchant_ads_connection_synced_if_current('
    );
    expect(sql).toContain('p_sync_run_id pg_catalog.uuid');
    expect(replacementSql).toContain(
      "raise exception 'ads sync run changed during spend replacement'"
    );
    expect(replacementSql).toContain(
      "raise exception 'google ads sync run changed during spend replacement'"
    );
    expect(sql).toContain('clear_merchant_ads_sync_run_on_identity_change');
  });

  it('rejects delayed older run starts while retaining the ordering floor across token rotation', () => {
    const sql = readFileSync(
      syncRunStartOrderMigrationPath,
      'utf8'
    ).toLowerCase();

    expect(sql).toContain(
      'add column if not exists sync_run_started_at pg_catalog.timestamptz'
    );
    expect(sql).toContain('p_sync_run_started_at > sync_run_started_at');
    expect(sql).toContain('p_sync_run_started_at = sync_run_started_at');
    expect(sql).toContain('sync_run_id is null and last_synced_at is null');
    expect(sql).toContain("+ pg_catalog.interval '5 minutes'");
    expect(sql).toContain('new.sync_run_id := null;');
    expect(sql).toContain(
      'new.access_token_ciphertext is distinct from old.access_token_ciphertext'
    );
    expect(sql).toContain(
      'new.refresh_token_ciphertext is distinct from old.refresh_token_ciphertext'
    );
    expect(sql).toContain('set last_synced_at = pg_catalog.now(),');
    expect(sql).toContain('sync_run_id = null');
    expect(sql).toContain('and sync_run_id = p_sync_run_id');
  });

  it('only exposes the persisted server timestamp for a current run', () => {
    const sql = readFileSync(
      serverOwnedSyncRunMigrationPath,
      'utf8'
    ).toLowerCase();

    expect(sql).toContain(
      'create or replace function public.get_merchant_ads_sync_run_started_at'
    );
    expect(sql).toContain('c.sync_run_id = p_sync_run_id');
    expect(sql).toContain("and c.status = 'active'");
    expect(sql).toContain('public.check_staff_permission');
    expect(sql).toContain(
      'revoke all on function public.get_merchant_ads_sync_run_started_at'
    );
    expect(sql).toContain(
      'grant execute on function public.get_merchant_ads_sync_run_started_at'
    );
  });

  it('persists exact completed ranges so empty windows can report freshness', () => {
    const sql = readFileSync(
      syncWindowCompletionMigrationPath,
      'utf8'
    ).toLowerCase();

    expect(sql).toContain(
      'add column if not exists last_synced_start_date pg_catalog.date'
    );
    expect(sql).toContain(
      'add column if not exists last_synced_end_date pg_catalog.date'
    );
    expect(sql).toContain(
      'merchant_ad_connections_last_synced_window_bounds_check'
    );
    expect(sql).toContain('p_sync_window_start_date pg_catalog.date');
    expect(sql).toContain('p_sync_window_end_date pg_catalog.date');
    expect(sql).toContain('last_synced_start_date = p_sync_window_start_date');
    expect(sql).toContain('last_synced_end_date = p_sync_window_end_date');
    expect(sql).toContain(
      'revoke all on function public.mark_merchant_ads_connection_synced_if_current('
    );
    expect(sql).toContain(
      'grant execute on function public.mark_merchant_ads_connection_synced_if_current('
    );
  });
});
