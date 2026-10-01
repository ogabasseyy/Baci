import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = [
  '20260805173000_harden_merchant_invoice_partial_completion.sql',
  '20260805173100_lock_merchant_invoice_exact_completion.sql',
]
  .map((filename) =>
    readFileSync(
      join(process.cwd(), '../../supabase/migrations', filename),
      'utf8'
    )
  )
  .join('\n');

const completedTransactionRepairMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260805190000_recheck_completed_merchant_invoice_exact_payments.sql'
  ),
  'utf8'
);

const reviewedPartialCaptureMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260806000100_retire_reviewed_merchant_invoice_partial_captures.sql'
  ),
  'utf8'
);

const serializedExactClaimMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260806000200_serialize_merchant_invoice_exact_claims.sql'
  ),
  'utf8'
);

const reviewedCaptureLedgerMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260808090000_exclude_reviewed_merchant_invoice_partial_captures.sql'
  ),
  'utf8'
);

const captureRetirementMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260808093000_preserve_merchant_invoice_partial_capture_retirement.sql'
  ),
  'utf8'
);

describe('merchant invoice partial payment hardening migration', () => {
  it('wraps both payment writers under the shared advisory lock', () => {
    expect(migration).toContain('complete_merchant_invoice_partial_payment_v1');
    expect(migration).toContain('complete_order_gateway_payment_v1');
    expect(
      migration.match(/'baci_order_payment:' \|\| p_order_id::text/g)
    ).toHaveLength(2);
    expect(migration).toMatch(
      /FROM public\.transactions AS t[\s\S]*FOR UPDATE;/
    );
    expect(migration).toMatch(/FROM public\.orders AS o[\s\S]*FOR UPDATE;/);
  });

  it('includes only active savings redemptions in both locked ledgers', () => {
    expect(
      migration.match(/FROM public\.customer_savings_redemptions AS r/g)
    ).toHaveLength(2);
    expect(
      migration.match(/r\.metadata ->> 'reversed_at' IS NULL/g)
    ).toHaveLength(2);
    expect(migration.match(/\+ v_savings_paid/g)).toHaveLength(2);
  });

  it('refuses a stale exact allocation and files transaction-scoped review', () => {
    const mismatchIndex = migration.indexOf(
      'IF abs(v_txn_amount - v_remaining_before) > 0.01'
    );
    const reviewIndex = migration.indexOf(
      "'merchant_invoice_partial_payment_conflict'",
      mismatchIndex
    );
    const completionIndex = migration.indexOf(
      'complete_order_gateway_payment_v1(',
      mismatchIndex
    );

    expect(mismatchIndex).toBeGreaterThan(-1);
    expect(reviewIndex).toBeGreaterThan(mismatchIndex);
    expect(completionIndex).toBeGreaterThan(reviewIndex);
    expect(migration).toContain(
      "'error_code', 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED'"
    );
    expect(migration).toContain('ON CONFLICT DO NOTHING');
  });

  it('marks only a successful exact completion as idempotently applied', () => {
    expect(migration).toContain("v_completion ->> 'payment_status' = 'paid'");
    expect(migration).toContain("'merchant_invoice_partial_applied', true");
    expect(migration).toContain(
      "'wedge_sweep_resolution', 'merchant_invoice_exact_completed'"
    );
  });

  it('rechecks the webhook-completed transaction but exempts its applied replay', () => {
    expect(completedTransactionRepairMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.complete_order_gateway_payment(\n  p_transaction_id uuid,'
    );
    expect(completedTransactionRepairMigration).toContain(
      "v_txn_status IN ('pending', 'completed')"
    );
    expect(completedTransactionRepairMigration).toMatch(
      /v_txn_metadata ->> 'merchant_invoice_partial_applied'\s+IS DISTINCT FROM 'true'/
    );
    expect(completedTransactionRepairMigration).toMatch(
      /t\.status = 'completed'[\s\S]*t\.id <> p_transaction_id/
    );
    expect(completedTransactionRepairMigration).toContain(
      "'error_code', 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED'"
    );
  });

  it('stops both canceled spellings under the lock before exact completion', () => {
    const terminalGuardIndex = completedTransactionRepairMigration.indexOf(
      "IN ('canceled', 'cancelled')"
    );
    const completionIndex = completedTransactionRepairMigration.indexOf(
      'complete_order_gateway_payment_v1(',
      terminalGuardIndex
    );

    expect(completedTransactionRepairMigration).toContain('o.shipping_status');
    expect(completedTransactionRepairMigration).toContain('o.cancelled_at');
    expect(terminalGuardIndex).toBeGreaterThan(-1);
    expect(completedTransactionRepairMigration).toContain(
      "'order_cancelled', true"
    );
    expect(completedTransactionRepairMigration).toMatch(
      /IF v_txn_status = 'pending' THEN[\s\S]*UPDATE public\.transactions AS t[\s\S]*SET status = 'completed'/
    );
    expect(completionIndex).toBeGreaterThan(terminalGuardIndex);
  });

  it('validates identifiers and stops an applied strict partial before delegation', () => {
    const partialReplayIndex = completedTransactionRepairMigration.indexOf(
      "= 'merchant_invoice_partial_recorded'"
    );
    const completionIndex = completedTransactionRepairMigration.indexOf(
      'complete_order_gateway_payment_v1(',
      partialReplayIndex
    );

    expect(completedTransactionRepairMigration).toContain(
      "'error_code', 'TRANSACTION_NOT_FOUND'"
    );
    expect(completedTransactionRepairMigration).toContain(
      "'error_code', 'ORDER_TRANSACTION_MISMATCH'"
    );
    expect(completedTransactionRepairMigration).toContain(
      "'error_code', 'ORDER_NOT_FOUND'"
    );
    expect(partialReplayIndex).toBeGreaterThan(-1);
    expect(completedTransactionRepairMigration).toContain(
      "'merchant_invoice_partial_recorded', true"
    );
    expect(completionIndex).toBeGreaterThan(partialReplayIndex);
  });

  it('keeps implementation functions private and wrappers service-only', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_merchant_invoice_partial_payment_v1\([\s\S]*FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_order_gateway_payment_v1\([\s\S]*FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.complete_merchant_invoice_partial_payment\([\s\S]*TO service_role;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.complete_order_gateway_payment\([\s\S]*TO service_role;/
    );
  });

  it('records reviewed strict partial captures and retires generated DVA placeholders', () => {
    expect(reviewedPartialCaptureMigration).toContain(
      "v_error_code = 'AMOUNT_EXCEEDS_REMAINING_BALANCE'"
    );
    expect(reviewedPartialCaptureMigration).toContain("status = 'completed'");
    expect(reviewedPartialCaptureMigration).toContain(
      "'wedge_sweep_resolution', 'merchant_invoice_partial_conflict_reviewed'"
    );
    expect(reviewedPartialCaptureMigration).toMatch(
      /UPDATE public\.transactions AS placeholder[\s\S]*status = 'cancelled'/
    );
    expect(reviewedPartialCaptureMigration).toContain(
      "placeholder.gateway_reference LIKE 'BAC-%'"
    );
    expect(reviewedPartialCaptureMigration).toContain(
      "placeholder.metadata ->> 'dva_account_number' IS NULL"
    );
  });

  it('counts only applied marked peers when serializing exact invoice claims', () => {
    expect(serializedExactClaimMigration).toMatch(
      /t\.status = 'completed'[\s\S]*t\.id <> p_transaction_id[\s\S]*t\.metadata ->> 'order_payment_allocation'[\s\S]*IS DISTINCT FROM 'merchant_invoice_partial'[\s\S]*OR t\.metadata ->> 'merchant_invoice_partial_applied' = 'true'/
    );
    expect(serializedExactClaimMigration).toContain(
      "'wedge_sweep_resolution', 'merchant_invoice_partial_conflict_reviewed'"
    );
    expect(serializedExactClaimMigration).toMatch(
      /IF abs\(v_txn_amount - v_remaining_before\) > 0\.01 THEN[\s\S]*UPDATE public\.transactions AS t[\s\S]*status = 'completed'/
    );
    expect(serializedExactClaimMigration).toContain(
      "'transaction_status', 'completed'"
    );
  });

  it('excludes reviewed partial captures from both partial-payment ledgers', () => {
    expect(
      reviewedCaptureLedgerMigration.match(
        /t\.metadata ->> 'order_payment_allocation' IS DISTINCT FROM 'merchant_invoice_partial'\n\s+OR t\.metadata ->> 'merchant_invoice_partial_applied' = 'true'/g
      )
    ).toHaveLength(2);
  });

  it('lets an applied exact completion retry reach the normal payment finalizer', () => {
    const exactReplayIndex = reviewedCaptureLedgerMigration.indexOf(
      "= 'merchant_invoice_exact_completed'"
    );
    const strictPartialReplayIndex = reviewedCaptureLedgerMigration.indexOf(
      "'outcome', 'partial_recorded'",
      exactReplayIndex
    );

    expect(exactReplayIndex).toBeGreaterThan(-1);
    expect(reviewedCaptureLedgerMigration).toContain(
      "'reason', 'exact_completion_replay'"
    );
    expect(strictPartialReplayIndex).toBeGreaterThan(exactReplayIndex);
  });

  it('preserves reviewed-capture retirement around the filtered ledger', () => {
    expect(captureRetirementMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.complete_merchant_invoice_partial_payment_v2\([\s\S]*SELECT public\.complete_merchant_invoice_partial_payment_v1\(/
    );
    expect(captureRetirementMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.complete_merchant_invoice_partial_payment\([\s\S]*SELECT public\.complete_merchant_invoice_partial_payment_v2\(/
    );
    expect(captureRetirementMigration).toContain(
      "'merchant_invoice_partial_conflict_reviewed'"
    );
    expect(captureRetirementMigration).toContain("status = 'cancelled'");
  });
});
