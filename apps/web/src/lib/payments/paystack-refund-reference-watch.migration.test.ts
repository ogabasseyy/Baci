import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928182500_paystack_refund_reference_watch.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('refund reference-watch migration', () => {
  it('allows one open reference watch per reference', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'ALTER COLUMN provider_refund_id DROP NOT NULL'
    );
    expect(migrationSql).toContain('paystack_refund_reference_watch_open_idx');
    expect(migrationSql).toContain(
      'WHERE provider_refund_id IS NULL AND status ='
    );
  });

  it('opens the reference watch and re-scans under the completion lock', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.open_paystack_refund_reference_watch_v1('
    );
    // Same reference key the completion path claims under: rows
    // returned mean the payment landed first, an empty set leaves the
    // watch open for the completion to claim.
    expect(migrationSql).toContain("'baci_paystack_refund_watch:'");
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.resolve_paystack_refund_reference_watch_v1('
    );
    // The resolver keeps claimed watches for future matching
    // completions; only the open handoff resolves.
    expect(migrationSql).toContain("AND status = 'open';");
    expect(migrationSql).not.toContain("status IN ('open', 'claimed')");
  });

  it('keeps a non-failed verdict when a failed redelivery refreshes the watch', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // A delayed failed redelivery must not overwrite an earlier
    // processed observation, or the claim files failed-only evidence
    // the audit reader excludes and cancellation refunds again.
    expect(migrationSql).toContain(
      "SET evidence = p_evidence || jsonb_build_object( 'provider_refund_status', CASE WHEN evidence->>'provider_refund_status' IS DISTINCT FROM 'failed' AND p_evidence->>'provider_refund_status' = 'failed' THEN evidence->>'provider_refund_status' ELSE p_evidence->>'provider_refund_status' END )"
    );
  });
});
