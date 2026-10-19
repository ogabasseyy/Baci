import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928182800_paystack_refund_watch_sticky_verdict.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('watch-evidence sticky-verdict migration', () => {
  it('replaces both openers in place without changing signatures', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.open_paystack_refund_recovery_watch_v1('
    );
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.open_paystack_refund_reference_watch_v1('
    );
    expect(migrationSql).not.toContain('DROP FUNCTION');
  });

  it('keeps a known non-failed verdict over later failed refreshes', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // A delayed failed observation must not overwrite an earlier
    // processed one: the claim would file failed-only evidence and
    // audit blocking would unblock the leg. Mirrors the leg-merge
    // truth table (trimmed, case-insensitive failed spelling).
    expect(migrationSql).toContain(
      "lower(btrim(evidence->>'provider_refund_status')) <> 'failed'"
    );
    expect(migrationSql).toContain(
      "lower(btrim(p_evidence->>'provider_refund_status')) = 'failed'"
    );
    expect(migrationSql).toContain('THEN evidence ELSE p_evidence END');
  });
});
