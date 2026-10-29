import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const scope = new URL('../../supabase/migrations/20261027051250_commerce_cart_quota_gigl_guard.sql', import.meta.url);
const grant = new URL('../../supabase/migrations/20261027051251_commerce_cart_supabase_quota_gigl_request_scope.sql', import.meta.url);
const cacheScope = new URL('../../supabase/migrations/20261028020000_cache_invalidation_worker_request_scope.sql', import.meta.url);
const quotaScopeRepair = new URL('../../supabase/migrations/20261029010000_restore_commerce_cart_quota_request_scope.sql', import.meta.url);

test('quota role is granted only after the scoped guard is installed', () => {
  const stageSql = readFileSync(scope, 'utf8');
  const grantSql = readFileSync(grant, 'utf8');
  const cacheScopeSql = readFileSync(cacheScope, 'utf8');
  const quotaScopeRepairSql = readFileSync(quotaScopeRepair, 'utf8');
  const bin = process.env.PG_BIN ?? execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  const dir = mkdtempSync(join(tmpdir(), 'baci-cart-quota-'));
  const run = (name, args, input) => execFileSync(join(bin, name), args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const connection = ['-h', dir, '-p', '55483', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  let started = false;
  try {
    run('initdb', ['-D', join(dir, 'data'), '-A', 'trust', '--no-locale', '-U', 'postgres']);
    run('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'), '-o', `-k ${dir} -h '' -p 55483`, '-w', 'start']);
    started = true;
    run('psql', connection, `
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE ROLE authenticator NOLOGIN;
      CREATE ROLE cache_invalidation_worker NOLOGIN;
      CREATE ROLE gigl_tracking_worker NOLOGIN;
      CREATE ROLE blog_media_sweep_worker NOLOGIN;
      CREATE ROLE mcp_guest_oauth_worker NOLOGIN;
      CREATE ROLE mcp_guest_cart_worker NOLOGIN;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
        $$ SELECT current_setting('request.jwt.claims', true)::jsonb->>'role' $$;
      CREATE FUNCTION public.enforce_gigl_tracking_worker_request_scope()
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      DECLARE
        request_method text := current_setting('request.method', true);
        request_path text := current_setting('request.path', true);
        request_role text := auth.role();
      BEGIN
        IF request_role = 'gigl_tracking_worker' THEN
          IF request_path IS DISTINCT FROM '/rpc/gigl_worker_claim_due_tracking_monitors' THEN
            RAISE EXCEPTION 'GIGL worker request is outside its capability scope' USING ERRCODE='42501';
          END IF;
        END IF;
      END $$;
      ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.enforce_gigl_tracking_worker_request_scope';
    `);
    run('psql', connection, stageSql);
    const membership = run('psql', [...connection, '-Atc',
      "SELECT pg_has_role('authenticator','commerce_cart_quota','MEMBER')"]);
    assert.equal(membership.trim(), 'f', 'scope phase does not grant the role');

    run('psql', connection, `
      SELECT set_config('request.jwt.claims','{"role":"anon"}',false);
      SELECT set_config('request.method','POST',false);
      SELECT set_config('request.path','/rpc/__commerce_cart_quota_hook_reload_canary__',false);
      DO $$ BEGIN
        PERFORM public.enforce_gigl_tracking_worker_request_scope();
        RAISE EXCEPTION 'canary unexpectedly passed';
      EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM NOT LIKE '%CART QUOTA hook reload canary observed%' THEN RAISE; END IF;
      END $$;
      SELECT set_config('request.jwt.claims','{"role":"commerce_cart_quota"}',false);
      SELECT set_config('request.path','/rpc/unrelated',false);
      DO $$ BEGIN
        PERFORM public.enforce_gigl_tracking_worker_request_scope();
        RAISE EXCEPTION 'unrelated RPC unexpectedly passed';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
      SELECT set_config('request.path','/rpc/increment_commerce_cart_quota',false);
      SELECT public.enforce_gigl_tracking_worker_request_scope();
      SELECT set_config('request.jwt.claims','{"role":"gigl_tracking_worker"}',false);
      SELECT set_config('request.path','/rpc/gigl_worker_claim_due_tracking_monitors',false);
      SELECT public.enforce_gigl_tracking_worker_request_scope();
    `);
    run('psql', connection, grantSql);
    const granted = run('psql', [...connection, '-Atc',
      "SELECT pg_has_role('authenticator','commerce_cart_quota','MEMBER')"]);
    assert.equal(granted.trim(), 't', 'later migration grants the role');
    // Reproduce the ordering regression: the cache migration rewrites the
    // shared hook after quota activation, then the append-only repair restores
    // the quota fence while preserving the cache worker capability.
    run('psql', connection, cacheScopeSql);
    run('psql', connection, quotaScopeRepairSql);
    run('psql', connection, `
      SELECT set_config('request.jwt.claims','{"role":"commerce_cart_quota"}',false);
      SELECT set_config('request.method','POST',false);
      SELECT set_config('request.path','/rpc/increment_commerce_cart_quota',false);
      SELECT public.enforce_gigl_tracking_worker_request_scope();
      SELECT set_config('request.path','/rpc/unrelated',false);
      DO $$ BEGIN
        PERFORM public.enforce_gigl_tracking_worker_request_scope();
        RAISE EXCEPTION 'unrelated quota RPC unexpectedly passed';
      EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM NOT LIKE '%Cart quota request is outside its capability scope%' THEN RAISE; END IF;
      END $$;
      SELECT set_config('request.jwt.claims','{"role":"cache_invalidation_worker"}',false);
      SELECT set_config('request.path','/rpc/claim_cache_invalidations',false);
      SELECT public.enforce_gigl_tracking_worker_request_scope();
      SELECT set_config('request.path','/rpc/increment_commerce_cart_quota',false);
      DO $$ BEGIN
        PERFORM public.enforce_gigl_tracking_worker_request_scope();
        RAISE EXCEPTION 'quota RPC unexpectedly passed for cache worker';
      EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM NOT LIKE '%Cache invalidation worker request is outside its capability scope%' THEN RAISE; END IF;
      END $$;
      SELECT position('commerce_cart_quota_request_scope_v1' IN pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure)) > 0;
      -- Assert the final definition retains every worker allowlist and every
      -- reload canary present before/after the cache-scope extension.
      DO $$
      DECLARE
        scenario record;
        observed_error text;
      BEGIN
        FOR scenario IN
          SELECT * FROM (VALUES
            ('gigl_tracking_worker','POST','/rpc/gigl_worker_apply_tracking_result',NULL),
            ('gigl_tracking_worker','POST','/rpc/gigl_worker_claim_due_tracking_monitors',NULL),
            ('gigl_tracking_worker','POST','/rpc/gigl_worker_pause_tracking_monitor',NULL),
            ('gigl_tracking_worker','POST','/rpc/gigl_worker_record_tracking_failure',NULL),
            ('gigl_tracking_worker','POST','/rpc/gigl_worker_release_tracking_claim',NULL),
            ('gigl_tracking_worker','POST','/rpc/unrelated','GIGL worker request is outside its capability scope'),
            ('blog_media_sweep_worker','POST','/rpc/blog_media_sweep_worker_claim',NULL),
            ('blog_media_sweep_worker','POST','/rpc/blog_media_sweep_worker_release',NULL),
            ('blog_media_sweep_worker','POST','/rpc/unrelated','Blog media worker request is outside its capability scope'),
            ('mcp_guest_oauth_worker','POST','/rpc/mcp_guest_oauth_read',NULL),
            ('mcp_guest_oauth_worker','POST','/rpc/mcp_guest_oauth_cas',NULL),
            ('mcp_guest_oauth_worker','POST','/rpc/mcp_guest_oauth_purge_expired',NULL),
            ('mcp_guest_oauth_worker','POST','/rpc/mcp_guest_oauth_seed_cart',NULL),
            ('mcp_guest_oauth_worker','POST','/rpc/unrelated','Guest OAuth worker request is outside its capability scope'),
            ('mcp_guest_cart_worker','POST','/rpc/get_mcp_guest_cart',NULL),
            ('mcp_guest_cart_worker','POST','/rpc/upsert_mcp_guest_cart',NULL),
            ('mcp_guest_cart_worker','POST','/rpc/delete_mcp_guest_cart',NULL),
            ('mcp_guest_cart_worker','POST','/rpc/unrelated','Guest cart worker request is outside its capability scope'),
            ('cache_invalidation_worker','POST','/rpc/claim_cache_invalidations',NULL),
            ('cache_invalidation_worker','POST','/rpc/finish_cache_invalidation',NULL),
            ('cache_invalidation_worker','POST','/rpc/has_cache_invalidation_dead_letters',NULL),
            ('cache_invalidation_worker','POST','/rpc/unrelated','Cache invalidation worker request is outside its capability scope'),
            ('commerce_cart_quota','POST','/rpc/increment_commerce_cart_quota',NULL),
            ('commerce_cart_quota','POST','/rpc/unrelated','Cart quota request is outside its capability scope'),
            ('anon','POST','/rpc/ordinary',NULL),
            ('authenticated','POST','/rpc/ordinary',NULL),
            ('anon','POST','/rpc/__gigl_hook_reload_canary__','GIGL hook reload canary observed'),
            ('anon','POST','/rpc/__blog_media_hook_reload_canary__','BLOG MEDIA hook reload canary observed'),
            ('anon','POST','/rpc/__guest_cart_hook_reload_canary__','GUEST CART hook reload canary observed'),
            ('anon','POST','/rpc/__guest_oauth_hook_reload_canary__','GUEST OAUTH hook reload canary observed'),
            ('anon','POST','/rpc/__cache_invalidation_hook_reload_canary__','CACHE INVALIDATION hook reload canary observed'),
            ('anon','POST','/rpc/__commerce_cart_quota_hook_reload_canary__','CART QUOTA hook reload canary observed')
          ) AS cases(role_name, method_name, path_name, expected_error)
        LOOP
          PERFORM set_config('request.jwt.claims', jsonb_build_object('role', scenario.role_name)::text, false);
          PERFORM set_config('request.method', scenario.method_name, false);
          PERFORM set_config('request.path', scenario.path_name, false);
          observed_error := NULL;
          BEGIN
            PERFORM public.enforce_gigl_tracking_worker_request_scope();
          EXCEPTION WHEN SQLSTATE '42501' THEN
            GET STACKED DIAGNOSTICS observed_error = MESSAGE_TEXT;
          END;
          IF observed_error IS DISTINCT FROM scenario.expected_error THEN
            RAISE EXCEPTION 'Scope behavior mismatch for scenario %', scenario.role_name;
          END IF;
        END LOOP;
      END $$;
    `);
    // Execute the actual maintenance query against PostgreSQL, not only a
    // stubbed Management API, so a syntax or aggregate error blocks CI.
    run('psql', connection, `
      CREATE SCHEMA cron;
      CREATE TABLE cron.job(jobid bigint, jobname text, active boolean, schedule text, command text);
      CREATE TABLE cron.job_run_details(jobid bigint, status text, end_time timestamptz);
      INSERT INTO cron.job VALUES
        (1, 'commerce-cart-quota-expiry', true, '*/10 * * * *', 'SELECT cart_quota.purge_expired(10000)');
      INSERT INTO cron.job_run_details VALUES (1, 'succeeded', now());
    `);
    const maintenanceScript = readFileSync(new URL('./verify-cart-quota-maintenance.sh', import.meta.url), 'utf8');
    const maintenanceSql = maintenanceScript.match(/\nsql="([\s\S]*?)"\nstart=/)?.[1];
    assert.ok(maintenanceSql, 'extract the query used by the release gate');
    assert.equal(run('psql', [...connection, '-At', '-F', ',', '-c', maintenanceSql]).trim(), 't,t,t');
    run('psql', connection, "UPDATE cron.job SET active = false; DELETE FROM cron.job_run_details;");
    assert.equal(run('psql', [...connection, '-At', '-F', ',', '-c', maintenanceSql]).trim(), 'f,t,f');
    run('psql', connection, `
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations VALUES ('20261027051251');
    `);
    assert.throws(
      () => run('psql', connection, stageSql),
      /quota grant migration already recorded/
    );
    const stillGranted = run('psql', [...connection, '-Atc',
      "SELECT pg_has_role('authenticator','commerce_cart_quota','MEMBER')"]);
    assert.equal(stillGranted.trim(), 't', 'late scope migration does not revoke an active role');
  } finally {
    if (started) run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop']);
    rmSync(dir, { recursive: true, force: true });
  }
});
