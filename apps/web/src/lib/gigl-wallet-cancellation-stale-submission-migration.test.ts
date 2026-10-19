import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903138000_harden_gigl_wallet_cancellation_and_stale_submission.sql`,
  'utf8'
);

describe('GIGL wallet cancellation and stale submission migration', () => {
  it('rejects cancellation while a booked wallet charge is still active', () => {
    expect(sql).toContain(
      "OR charge.status IN ('booked', 'needs_reconciliation')"
    );
    expect(sql).toContain(
      "charge.status IN ('reserved', 'provider_submitting')"
    );
  });

  it('recovers stale provider submissions during reservation with a fresh attempt token', () => {
    expect(sql).toContain("v_existing.status = 'provider_submitting'");
    expect(sql).toContain(
      "provider_submitting_at <= now() - interval '15 minutes'"
    );
    expect(sql).toContain("SET status = 'reserved'");
    expect(sql).toContain('attempt_token_digest = pg_catalog.encode');
  });
});
