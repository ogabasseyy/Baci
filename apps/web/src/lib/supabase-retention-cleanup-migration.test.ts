import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const initialMigrationSql = readFileSync(
  resolve(
    testDir,
    '../../../../supabase/migrations/20260524162010_supabase_retention_cleanup.sql'
  ),
  'utf8'
);
const hardeningMigrationSql = readFileSync(
  resolve(
    testDir,
    '../../../../supabase/migrations/20260524221240_harden_supabase_retention_cleanup_function.sql'
  ),
  'utf8'
);
const coalesceRepairMigrationSql = readFileSync(
  resolve(
    testDir,
    '../../../../supabase/migrations/20260525044634_fix_supabase_retention_coalesce_special_form.sql'
  ),
  'utf8'
);
const batchedCleanupMigrationSql = readFileSync(
  resolve(
    testDir,
    '../../../../supabase/migrations/20261117112807_batch_supabase_retention_cleanup.sql'
  ),
  'utf8'
);
const analyticsRetentionIndexMigrationSql = readFileSync(
  resolve(
    testDir,
    '../../../../supabase/migrations/20261117112808_index_analytics_events_low_value_retention.sql'
  ),
  'utf8'
);
const normalizedInitialMigrationSql = initialMigrationSql.replace(/\s+/g, ' ');
const normalizedHardeningMigrationSql = hardeningMigrationSql.replace(
  /\s+/g,
  ' '
);
const normalizedCoalesceRepairMigrationSql = coalesceRepairMigrationSql.replace(
  /\s+/g,
  ' '
);
const normalizedBatchedCleanupMigrationSql = batchedCleanupMigrationSql.replace(
  /\s+/g,
  ' '
);
const normalizedAnalyticsRetentionIndexMigrationSql =
  analyticsRetentionIndexMigrationSql.replace(/\s+/g, ' ');

describe('Supabase retention cleanup migration', () => {
  it('preserves the live-applied initial migration and hardens the RPC in a follow-up migration', () => {
    expect(normalizedInitialMigrationSql).toContain(
      'SECURITY DEFINER SET search_path = public, cron, net'
    );
    expect(initialMigrationSql).toContain(
      'COALESCE(event_timestamp, created_at)'
    );
    expect(initialMigrationSql).toContain('clock_timestamp()');
    expect(initialMigrationSql).not.toContain('pg_catalog.coalesce');
    expect(initialMigrationSql).not.toContain('pg_catalog.clock_timestamp');
    expect(normalizedHardeningMigrationSql).toContain(
      "SECURITY DEFINER SET search_path = ''"
    );
    expect(hardeningMigrationSql).toContain('pg_catalog.clock_timestamp()');
    expect(hardeningMigrationSql).toContain(
      'DELETE FROM public.analytics_events'
    );
    expect(hardeningMigrationSql).toContain('DELETE FROM cron.job_run_details');
    expect(hardeningMigrationSql).toContain('DELETE FROM net._http_response');
    expect(normalizedHardeningMigrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.cleanup_database_retention(interval, interval, interval) FROM PUBLIC, anon, authenticated'
    );
    expect(normalizedHardeningMigrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.cleanup_database_retention(interval, interval, interval) TO service_role'
    );
  });

  it('repairs the hardened RPC without treating COALESCE as a catalog function', () => {
    expect(normalizedCoalesceRepairMigrationSql).toContain(
      "SECURITY DEFINER SET search_path = ''"
    );
    expect(coalesceRepairMigrationSql).toContain(
      'COALESCE(events.event_timestamp, events.created_at)'
    );
    expect(coalesceRepairMigrationSql).toContain(
      'COALESCE(runs.end_time, runs.start_time)'
    );
    expect(coalesceRepairMigrationSql).not.toContain('pg_catalog.coalesce');
    expect(coalesceRepairMigrationSql).toContain(
      'pg_catalog.clock_timestamp()'
    );
    expect(normalizedCoalesceRepairMigrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.cleanup_database_retention(interval, interval, interval) FROM PUBLIC, anon, authenticated'
    );
    expect(normalizedCoalesceRepairMigrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.cleanup_database_retention(interval, interval, interval) TO service_role'
    );
  });

  it('batches deletions with bounded loops and adds a partial retention index without breaking COALESCE or search_path hardening', () => {
    expect(normalizedBatchedCleanupMigrationSql).toContain(
      "SECURITY DEFINER SET search_path = ''"
    );
    expect(batchedCleanupMigrationSql).toContain(
      'pg_catalog.clock_timestamp()'
    );
    expect(batchedCleanupMigrationSql).not.toContain('pg_catalog.coalesce');
    expect(batchedCleanupMigrationSql).toContain(
      'COALESCE(events.event_timestamp, events.created_at)'
    );
    expect(batchedCleanupMigrationSql).toContain(
      'COALESCE(runs.end_time, runs.start_time)'
    );
    expect(batchedCleanupMigrationSql).toContain(
      'DELETE FROM public.analytics_events'
    );
    expect(batchedCleanupMigrationSql).toContain(
      'DELETE FROM cron.job_run_details'
    );
    expect(batchedCleanupMigrationSql).toContain(
      'DELETE FROM net._http_response'
    );
    expect(batchedCleanupMigrationSql).toContain('LIMIT v_batch_size');
    expect(batchedCleanupMigrationSql).toContain(
      'EXIT WHEN v_batches >= v_max_batches_per_table'
    );
    expect(normalizedBatchedCleanupMigrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.cleanup_database_retention(interval, interval, interval) FROM PUBLIC, anon, authenticated'
    );
    expect(normalizedBatchedCleanupMigrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.cleanup_database_retention(interval, interval, interval) TO service_role'
    );

    expect(
      analyticsRetentionIndexMigrationSql.startsWith('-- disable-transaction')
    ).toBe(true);
    expect(normalizedAnalyticsRetentionIndexMigrationSql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS analytics_events_low_value_retention_idx ON public.analytics_events ((COALESCE(event_timestamp, created_at)))'
    );
    expect(normalizedAnalyticsRetentionIndexMigrationSql).toContain(
      "WHERE event_type IN ('page_view', 'search')"
    );
  });
});
