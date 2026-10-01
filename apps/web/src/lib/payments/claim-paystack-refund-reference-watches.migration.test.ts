import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928182700_claim_paystack_refund_reference_watches.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('claim reference watches migration', () => {
  it('claims reference watches through the dedicated filing path', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_paystack_refund_recovery_watches_v1('
    );
    // NULL refund id marks reference-only watches: file the
    // per-payment review, then claim. ID-keyed handling below is
    // unchanged.
    expect(migrationSql).toContain(
      'IF v_watch.provider_refund_id IS NULL THEN'
    );
    expect(migrationSql).toContain(
      'file_paystack_refund_reference_watch_claim_v1('
    );
    // A missing or blank verdict fails closed as unknown — the
    // nested entry still blocks the leg until operations triages it.
    expect(migrationSql).toContain(
      "v_watch.evidence->>'provider_refund_status'"
    );
  });
});
