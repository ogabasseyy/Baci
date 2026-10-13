import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260902100000_repair_reconciliation_review_issue_types.sql'
  ),
  'utf8'
);

describe('reconciliation review issue type repair migration', () => {
  it('recreates and validates the full issue type check including merchant wallet DVA conflicts', () => {
    const issueTypes = [
      'payment_match_ambiguous',
      'payment_match_zero_candidates',
      'manage_stock_cancellation_held',
      'tax_basis_unclassified',
      'tax_basis_inconsistent_total',
      'wallet_dva_order_alias_conflict',
      'customer_savings_auto_debit_allocation_failed',
      'wallet_order_funding_ambiguous',
      'wallet_order_funding_conflict',
      'wallet_order_funding_finalize_failed',
      'payment_received_after_cancellation',
      'payment_received_after_refund',
      'serialized_inventory_confirmation_failed',
      'merchant_settlement_failed',
      'gateway_payment_wedge_requires_review',
      'credit_direct_confirmation_missing',
      'order_cancellation_refund_requires_review',
      'paypal_capture_persist_failed',
      'merchant_invoice_partial_payment_conflict',
    ];
    const checkBody = migration.match(
      /ADD CONSTRAINT reconciliation_review_issue_type_check CHECK \(issue_type IN \((?<body>[\s\S]*?)\)\) NOT VALID/
    )?.groups?.body;

    expect(checkBody).toBeDefined();
    for (const issueType of issueTypes) {
      expect(checkBody).toContain(`'${issueType}'`);
    }
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS reconciliation_review_issue_type_check'
    );
    expect(migration).toContain("'wallet_dva_order_alias_conflict'");
    expect(migration).toContain(
      'ADD CONSTRAINT reconciliation_review_issue_type_check CHECK'
    );
    expect(migration).toContain(
      'VALIDATE CONSTRAINT reconciliation_review_issue_type_check'
    );
  });
});
