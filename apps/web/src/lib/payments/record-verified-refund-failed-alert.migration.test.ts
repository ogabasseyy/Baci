import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928183400_record_verified_refund_failed_alert.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('record verified refund failed alert migration', () => {
  it('queues the merchant-failure alert before the already-failed return', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Legacy failed rows predate the notification table, and the
    // periodic refund workers exclude failed rows: the first verified
    // failure verdict must ensure the alert exists instead of
    // acknowledging silently. Repeat verdicts carry no new evidence,
    // so the conflict does nothing and never re-alerts.
    const alreadyFailedIdx = migrationSql.indexOf(
      "IF v_refund.status = 'failed' AND v_status <> 'processed' THEN"
    );
    expect(alreadyFailedIdx).toBeGreaterThan(-1);
    const blockEnd = migrationSql.indexOf('END IF;', alreadyFailedIdx);
    expect(blockEnd).toBeGreaterThan(alreadyFailedIdx);
    const block = migrationSql.slice(alreadyFailedIdx, blockEnd);
    expect(block).toContain(
      'INSERT INTO public.paystack_cancellation_refund_notifications'
    );
    expect(block).toContain("'failed_merchant_push'");
    expect(block).toContain('ON CONFLICT (order_id, event_type) DO NOTHING');
    expect(block).not.toContain('DO UPDATE');
    expect(block).toContain("RETURN 'already_failed'");
  });

  it('normalizes gateways exactly like the aggregate coverage gate', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'AND public.normalized_gateway_name_v1(gateway) = public.normalized_gateway_name_v1(v_refund.gateway)'
    );
    // The external-leg count normalizes too: a raw gateway against an
    // uppercase internal list would count wallet legs as external and
    // misfire the sole-payment rule.
    expect(migrationSql).toContain(
      "AND COALESCE(public.normalized_gateway_name_v1(gateway), '') NOT IN ("
    );
    expect(migrationSql).not.toContain("coalesce(gateway, '') NOT IN");
    expect(migrationSql).toContain(
      'AND public.normalized_gateway_name_v1(r.gateway) = public.normalized_gateway_name_v1(p.gateway)'
    );
  });
});
