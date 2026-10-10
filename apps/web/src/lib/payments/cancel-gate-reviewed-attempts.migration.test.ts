import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const gateMigrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928184600_cancel_gate_ignores_reviewed_abandoned_attempts.sql'
);
const indexMigrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928184500_missing_ref_candidate_and_watch_sweep_indexes.sql'
);
const transitionMigrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928184800_transition_captured_abandoned_legs_for_cancellation.sql'
);
const narrowGateMigrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928185100_narrow_cancel_gate_to_handled_abandoned_stamps.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('cancel gate reviewed-attempt migration', () => {
  it('carves stamped attempts out of the in-flight cancellation block', () => {
    expect(existsSync(gateMigrationPath)).toBe(true);
    if (!existsSync(gateMigrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(gateMigrationPath, 'utf8'));

    // The sweep excludes stamped rows with this exact predicate; the
    // gate must match it or a reviewed capture blocks its order
    // permanently — never reselected, yet failing every
    // cancellation.
    expect(migrationSql).toContain(
      "AND t.metadata->'abandoned_sweep_resolution' IS NULL"
    );
    // The genuine in-flight block stays: unstamped pending and
    // processing legs still reject cancellation.
    expect(migrationSql).toContain("t.status IN ('pending', 'processing')");
    expect(migrationSql).toContain('payment_capture_in_flight');
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.cancel_order_as_merchant('
    );
  });

  it('fails closed on funds-plausible stamps until ops closes the queue', () => {
    expect(existsSync(narrowGateMigrationPath)).toBe(true);
    if (!existsSync(narrowGateMigrationPath)) return;

    const migrationSql = normalizeSql(
      readFileSync(narrowGateMigrationPath, 'utf8')
    );

    // Same signature: OR REPLACE keeps every existing call on the
    // new body.
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.cancel_order_as_merchant('
    );
    // Verified captures (transitioned below) and provably fundless
    // rows (missing/invalid reference, provider-terminal verdict)
    // cancel past; everything else must clear the ops queue first.
    expect(migrationSql).toContain("'partial_capture_short_reviewed'");
    expect(migrationSql).toContain("'verified_success_captured'");
    expect(migrationSql).toContain("'missing_reference'");
    expect(migrationSql).toContain("'invalid_reference'");
    expect(migrationSql).toContain("'terminal_evidence_mismatch'");
    // The escape hatch: a stamped leg with no open review (own
    // entry or merged evidence) is ops-accepted. Mismatch and
    // conflict stamps are deliberately absent from the allowlist —
    // cancelling past them would strand a captured charge with no
    // refund leg. (Quoted: prose mentions the families unquoted.)
    expect(migrationSql).not.toContain("'verified_capture_mismatch_reviewed'");
    expect(migrationSql).not.toContain(
      "'merchant_invoice_partial_conflict_reviewed'"
    );
    expect(migrationSql).toContain(
      "r.metadata->'captured_attempts' ? t.id::text"
    );
    expect(migrationSql).toContain(
      "r.metadata->'mismatched_attempts' ? t.id::text"
    );
    expect(migrationSql).toContain('payment_capture_in_flight');
  });
});

describe('missing-ref candidate and watch sweep index migration', () => {
  it('covers the missing-reference branch the normalized index cannot serve', () => {
    expect(existsSync(indexMigrationPath)).toBe(true);
    if (!existsSync(indexMigrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(indexMigrationPath, 'utf8'));

    // The normalized candidate index requires gateway_reference IS
    // NOT NULL, so the missing-reference branch needs its own
    // partial index with the nullness flipped (same keys, same
    // remaining predicates).
    expect(migrationSql).toContain(
      'paystack_abandoned_missing_ref_candidates_idx'
    );
    expect(migrationSql).toContain('gateway_reference IS NULL');
    expect(migrationSql).toContain('updated_at ASC NULLS FIRST, id');
  });

  it('transitions verified-captured legs into the refund path on cancel', () => {
    expect(existsSync(transitionMigrationPath)).toBe(true);
    if (!existsSync(transitionMigrationPath)) return;

    const migrationSql = normalizeSql(
      readFileSync(transitionMigrationPath, 'utf8')
    );

    // Only resolutions with a durable verified amount transition;
    // conflict, missing-reference, and mismatch stamps stay carved
    // pending for operations.
    expect(migrationSql).toContain('partial_capture_short_reviewed');
    expect(migrationSql).toContain('verified_success_captured');
    // The captured value comes from the open review (own entry or
    // sibling append), guarded to still-pending so a concurrent
    // webhook completion wins, and the original attempt amount is
    // preserved for audit.
    expect(migrationSql).toContain("metadata->>'capture_amount_minor'");
    expect(migrationSql).toContain("metadata->>'provider_amount'");
    expect(migrationSql).toContain('original_attempt_amount');
    expect(migrationSql).toContain(
      "SET status = 'completed', amount = v_captured_minor / 100.0"
    );
    // The credited amount joins the order balance so coverage and
    // finalization see the captured funds as a standard leg.
    expect(migrationSql).toContain(
      'SET amount_paid = COALESCE(amount_paid, 0) + v_captured_minor / 100.0'
    );
  });

  it('indexes the open-watch sweep by its rotation column', () => {
    expect(existsSync(indexMigrationPath)).toBe(true);
    if (!existsSync(indexMigrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(indexMigrationPath, 'utf8'));

    // The sweep orders open watches by updated_at (the touch column
    // its rotation bumps); the created_at sweep index cannot serve
    // that ordering.
    expect(migrationSql).toContain(
      'paystack_refund_recovery_watch_open_updated_idx'
    );
    expect(migrationSql).toContain("WHERE status = 'open'");
  });
});
