import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260927150450_close_verified_cancellation_refund_reviews.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('close verified cancellation refund reviews migration', () => {
  it('auto-closes explicitly unambiguous lone failed-leg reviews', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // New deterministic and exhausted-rate-limit filings record
    // ambiguous_initiation: false; only legacy rows with no marker at
    // all stay open as ambiguous.
    expect(migrationSql).toContain(
      "OR (review.metadata->>'ambiguous_initiation')::boolean IS FALSE"
    );
  });

  it('keeps orphan provider evidence open until a local refund row matches it', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "review.metadata->>'audit_record_failed' IS DISTINCT FROM 'true'"
    );
    expect(migrationSql).toContain(
      "r.gateway_reference = review.metadata->>'provider_refund_id'"
    );
    expect(migrationSql).toContain(
      "r.gateway_reference = split_part(e.key, ':', 2)"
    );
  });
});
