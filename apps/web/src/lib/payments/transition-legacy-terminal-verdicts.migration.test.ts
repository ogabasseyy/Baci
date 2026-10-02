import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928184000_transition_legacy_terminal_verdicts.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('legacy terminal verdict transition migration', () => {
  it('treats a repeat verdict as a no-op only after its transition is durable', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Failed rows return above, so a failed verdict here always needs
    // its transition — except on a terminal completed row whose
    // contradiction is already surfaced. Needs-attention settles at
    // refund_pending.
    expect(migrationSql).toContain(
      "(v_status = 'failed' AND v_refund.status = 'completed')"
    );
    expect(migrationSql).toContain(
      "(v_status = 'needs-attention' AND v_refund.status IN ('refund_pending', 'completed'))"
    );
  });

  it('requires the failure alert to be durable before skipping it', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'SELECT 1 FROM public.paystack_cancellation_refund_notifications n'
    );
    expect(migrationSql).toContain("AND n.event_type = 'failed_merchant_push'");
  });

  it('stays within the file modularity limit', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const lineCount = readFileSync(migrationPath, 'utf8').split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(300);
  });
});
