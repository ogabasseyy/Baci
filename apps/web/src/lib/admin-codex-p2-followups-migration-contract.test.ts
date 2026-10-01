import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const errorFilterSql = read(
  'supabase/migrations/20260817210000_repair_admin_projected_error_code_filters.sql'
).toLowerCase();
const segmentTimezoneSql = read(
  'supabase/migrations/20260817211000_repair_notification_segment_and_timezone_invariants.sql'
).toLowerCase();

describe('admin codex p2 followups migration contract', () => {
  it('filters ingress and delivery admin reads by projected error codes', () => {
    expect(errorFilterSql).toContain(
      'private.project_admin_error_code_v1(failure.failure_code) = p_error_code'
    );
    expect(errorFilterSql).toContain(
      'private.project_admin_error_code_v1(delivery.last_error_code) = p_error_code'
    );
    expect(errorFilterSql).toContain(
      "raise exception 'invalid_projected_error_code'"
    );
  });

  it('filters replay selection by projected delivery error codes', () => {
    expect(errorFilterSql).toContain(
      'create or replace function public.select_event_pipeline_replay_ids_v1'
    );
    expect(errorFilterSql).toContain(
      'private.project_admin_error_code_v1(delivery.last_error_code) = p_error_code'
    );
  });

  it('bases notification segment activity on immutable paid sale time', () => {
    expect(segmentTimezoneSql).toContain(
      'max(coalesce(o.paid_at, o.created_at)) as last_paid_at'
    );
    expect(segmentTimezoneSql).not.toContain('o.updated_at');
  });

  it('enforces valid quiet-hours time zones at the database boundary', () => {
    expect(segmentTimezoneSql).toContain('private.is_valid_iana_time_zone_v1');
    expect(segmentTimezoneSql).toContain(
      'notification_preferences_quiet_hours_time_zone_valid'
    );
    expect(segmentTimezoneSql).toContain('pg_catalog.pg_timezone_names');
  });
});
