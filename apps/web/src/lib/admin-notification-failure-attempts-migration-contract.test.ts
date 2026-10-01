import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260814130000_separate_quiet_deferral_failure_attempts.sql'
  ),
  'utf8'
).toLowerCase();

describe('quiet deferral failure attempts migration contract', () => {
  it('tracks real delivery failures separately from the started marker', () => {
    expect(sql).toContain(
      'delivery_failure_attempts integer not null default 0'
    );
    expect(sql).toContain(
      'delivery_attempts = greatest(n.delivery_attempts, 1)'
    );
    expect(sql).toContain(
      'delivery_failure_attempts = delivery_failure_attempts + 1'
    );
    expect(sql).not.toContain('delivery_attempts = n.delivery_attempts + 1');
  });

  it('keeps quiet-hour polls eligible after the failure retry ceiling', () => {
    expect(sql).toContain(
      "n.delivery_last_error in ('quiet_hours_deferred', 'quiet_hours_claimed')"
    );
    expect(sql).toContain('n.delivery_failure_attempts < 3');
  });

  it('counts expired non-quiet leases toward the failure budget and prunes stale snapshots', () => {
    expect(sql).toContain('n.delivery_failure_attempts + 1');
    expect(sql).toContain("'scheduled delivery lease expired'");
    expect(sql).toContain('delivery_failure_attempts + 1 >= 3');
    expect(sql).toContain(
      'and (n.delivery_claimed_at is null or n.delivery_claimed_at < statement_timestamp() - interval'
    );
    expect(sql).not.toContain(
      "and n.delivery_last_error not in ('quiet_hours_deferred', 'quiet_hours_claimed')"
    );
  });

  it('prunes audience snapshots when the third retry finalization fails', () => {
    const finalizeSql = sql.slice(
      sql.indexOf(
        'create or replace function public.finalize_scheduled_admin_notification_v1'
      )
    );
    const retryBranch = finalizeSql.slice(finalizeSql.indexOf('else'));

    expect(retryBranch).toContain('n.delivery_failure_attempts + 1 >= 3');
    expect(retryBranch).toContain(
      'when delivery_failure_attempts + 1 >= 3 then scheduled_for'
    );
  });
});
