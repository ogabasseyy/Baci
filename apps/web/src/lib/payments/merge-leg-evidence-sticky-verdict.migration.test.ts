import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928182400_merge_leg_evidence_sticky_verdict.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('leg-evidence sticky-verdict migration', () => {
  it('replaces the merge in place without changing its signature', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.merge_paystack_cancellation_refund_leg_evidence_v1('
    );
    expect(migrationSql).not.toContain('DROP FUNCTION');
  });

  it('keeps a known non-failed verdict over later failed merges', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // A delayed failed delivery must not erase an earlier processed
    // observation back to failed-only: the audit reader would
    // unblock the leg and initiate another refund. Mirrors the
    // reader's failed spelling (trimmed, case-insensitive).
    expect(migrationSql).toContain(
      "lower(btrim(v_existing_status)) <> 'failed'"
    );
    expect(migrationSql).toContain(
      "lower(btrim(v_incoming_status)) = 'failed'"
    );
    expect(migrationSql).toContain('v_status := v_existing_status');
    // Verdict-less quarantine merges never clear a known verdict
    // either — but they still fail closed over failed entries.
    expect(migrationSql).toContain('v_incoming_status IS NULL');
    expect(migrationSql).toContain("'provider_refund_status', v_status");
  });
});
