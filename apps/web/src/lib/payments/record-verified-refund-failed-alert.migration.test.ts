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
      "AND NULLIF( upper( regexp_replace( COALESCE(gateway, ''), '^\\s+|\\s+$', '', 'g' ) ), '' ) = NULLIF( upper( regexp_replace( COALESCE(v_refund.gateway, ''), '^\\s+|\\s+$', '', 'g' ) ), '' )"
    );
    expect(migrationSql).toContain(
      "AND NULLIF( upper( regexp_replace( COALESCE(r.gateway, ''), '^\\s+|\\s+$', '', 'g' ) ), '' ) = NULLIF( upper( regexp_replace( COALESCE(p.gateway, ''), '^\\s+|\\s+$', '', 'g' ) ), '' )"
    );
  });
});
