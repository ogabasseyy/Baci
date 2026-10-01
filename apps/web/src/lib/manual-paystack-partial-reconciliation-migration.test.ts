import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260811100000_manual_paystack_partial_reconciliation.sql'
  ),
  'utf8'
);
const referenceClaimMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260811110000_serialize_paystack_reference_claims.sql'
  ),
  'utf8'
);
const emailMismatchMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260811120000_allow_reviewed_paystack_email_mismatch.sql'
  ),
  'utf8'
);
const walletClaimMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260811130000_serialize_wallet_paystack_reference_claims.sql'
  ),
  'utf8'
);
const reviewContractMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260811140000_harden_paystack_manual_reconciliation_review_contracts.sql'
  ),
  'utf8'
);
const chatOrderMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260811135000_harden_paystack_chat_order_relationship.sql'
  ),
  'utf8'
);
const retryMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260811150000_idempotent_paystack_reconciliation_retries.sql'
  ),
  'utf8'
);
const retryGreatestFixMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260811180000_fix_paystack_reconciliation_retry_balance.sql'
  ),
  'utf8'
);
const retryIndexMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260811160000_index_paystack_reconciliation_retry_lookup.sql'
  ),
  'utf8'
);
const operatorAccessMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260811170000_require_paystack_reconciliation_operator_access.sql'
  ),
  'utf8'
);
const internalVersionsMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260812100000_revoke_paystack_reconciliation_internal_versions.sql'
  ),
  'utf8'
);
const retryScopeMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260812110000_harden_paystack_reconciliation_retry_scope.sql'
  ),
  'utf8'
);

describe('manual Paystack partial reconciliation migration', () => {
  it('locks and validates the review, order, and provider reference', () => {
    expect(migration).toContain("auth.role()) IS DISTINCT FROM 'service_role'");
    expect(migration).toContain('FROM public.reconciliation_review AS rr');
    expect(migration).toContain('FROM public.orders AS o');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain(
      "v_review_issue_type <> 'payment_match_zero_candidates'"
    );
    expect(migration).toContain('paystack_reference_already_recorded');
  });

  it('shares the Paystack reference lock with chat-order conversion', () => {
    expect(referenceClaimMigration).toContain('pg_advisory_xact_lock');
    expect(referenceClaimMigration).toContain(
      'hashtextextended(trim(p_reference), 0)'
    );
    expect(referenceClaimMigration).toContain(
      'private.convert_chat_order_to_paid_order_with_inventory('
    );
    expect(referenceClaimMigration).toContain(
      'paystack_reference_already_recorded'
    );
    expect(chatOrderMigration).toContain('o.chat_order_id = co.id');
  });

  it('creates a separate partial transaction and delegates completion atomically', () => {
    expect(migration).toContain("'manual_reconciliation', true");
    expect(migration).toContain(
      "'order_payment_allocation', 'merchant_invoice_partial'"
    );
    expect(migration).toContain(
      'public.complete_merchant_invoice_partial_payment('
    );
    expect(migration).toContain("'manual_paystack_partial_applied'");
  });

  it('resolves the review and records an operator audit row after success', () => {
    expect(migration).toContain('resolved_at = now()');
    expect(migration).toContain('resolution_notes = format(');
    expect(migration).toContain('INSERT INTO public.audit_logs');
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.reconcile_paystack_unmatched_partial_payment[^;]*TO service_role;/
    );
  });

  it('requires reviewed evidence and records an explicit email mismatch override', () => {
    expect(emailMismatchMigration).toContain('p_allow_email_mismatch boolean');
    expect(emailMismatchMigration).toContain(
      'email_mismatch_override_requires_explicit_operator_actor'
    );
    expect(emailMismatchMigration).toContain(
      'email_mismatch_review_evidence_missing'
    );
    expect(emailMismatchMigration).toContain("'email_mismatch_override', true");
    expect(emailMismatchMigration).toContain(
      "'manual_paystack_email_mismatch_override'"
    );
  });

  it('uses the shared Paystack reference lock for wallet reservations', () => {
    expect(walletClaimMigration).toContain(
      'claim_paystack_wallet_dva_transaction'
    );
    expect(walletClaimMigration).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(walletClaimMigration).toContain(
      'paystack_reference_already_recorded'
    );
    expect(walletClaimMigration).toContain('wallet_topup');
  });

  it('normalizes manual Paystack references and fails closed on missing transaction ids', () => {
    expect(reviewContractMigration).toContain(
      "lower(trim(COALESCE(t.gateway, ''))) = 'paystack'"
    );
    expect(reviewContractMigration).toContain(
      'email_mismatch_override_missing_transaction_id'
    );
  });

  it('requires the reconciliation operator to belong to the merchant', () => {
    expect(operatorAccessMigration).toContain(
      "RAISE EXCEPTION 'operator_not_authorized_for_merchant'"
    );
    expect(operatorAccessMigration).toContain('m.user_id = p_operator_user_id');
    expect(operatorAccessMigration).toContain('sm.merchant_id = p_merchant_id');
    expect(operatorAccessMigration).toContain("sm.status = 'active'");
  });

  it('revokes direct service-role access to internal reconciliation versions', () => {
    expect(
      internalVersionsMigration.match(/REVOKE ALL ON FUNCTION/g)
    ).toHaveLength(4);
    expect(internalVersionsMigration).toMatch(
      /reconcile_paystack_unmatched_partial_payment_v1[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(internalVersionsMigration).toMatch(
      /reconcile_paystack_unmatched_partial_payment_v2[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/
    );
  });

  it('scopes retry wrappers to order-edit operators and the selected merchant', () => {
    expect(retryScopeMigration.match(/check_staff_permission/g)).toHaveLength(
      1
    );
    expect(retryScopeMigration).toContain('t.merchant_id = p_merchant_id');
    expect(retryScopeMigration).toContain('o.merchant_id = p_merchant_id');
  });

  it('uses durable chat-order linkage for conversion retries', () => {
    expect(chatOrderMigration).toContain(
      'ADD COLUMN IF NOT EXISTS chat_order_id uuid'
    );
    expect(chatOrderMigration).toContain('o.chat_order_id = co.id');
    expect(chatOrderMigration).toContain('payment_reference');
    expect(chatOrderMigration).toContain('HAVING count(DISTINCT co.id) = 1');
    expect(chatOrderMigration).not.toContain(
      "o.notes = 'Converted from chat order. Session: ' || co.session_id"
    );
    expect(chatOrderMigration).not.toContain(
      'JOIN public.orders AS o\n            ON o.notes ='
    );
  });

  it('returns the committed result for an idempotent reconciliation retry', () => {
    expect(retryMigration).toContain(
      "t.metadata ->> 'reconciliation_review_id' = p_review_id::text"
    );
    expect(retryMigration).toContain(
      "t.metadata ->> 'merchant_invoice_partial_applied' = 'true'"
    );
    expect(retryMigration).toContain(
      "t.metadata ->> 'email_mismatch_override' = 'true'"
    );
    expect(retryMigration).toContain(
      "t.metadata ->> 'email_mismatch_override' IS NULL"
    );
    expect(retryGreatestFixMigration).toMatch(
      /\bgreatest\(0,\s*v_total\s*-\s*v_amount_paid\)/i
    );
    expect(retryGreatestFixMigration).not.toContain('pg_catalog.greatest');
    expect(retryMigration).toContain("'already_completed', true");
    expect(retryMigration).toContain('paystack_reference_already_recorded');
    expect(retryMigration).toContain('FOR UPDATE OF t, o');
    const orderLock = retryMigration.indexOf(
      "hashtextextended('baci_order_payment:' || p_order_id::text, 0)"
    );
    const referenceLock = retryMigration.indexOf(
      'hashtextextended(trim(p_paystack_reference), 0)'
    );
    expect(orderLock).toBeGreaterThanOrEqual(0);
    expect(referenceLock).toBeGreaterThan(orderLock);
  });

  it('indexes the JSONB predicates used by reconciliation retries', () => {
    expect(retryIndexMigration).toContain(
      'transactions_paystack_reconciliation_retry_idx'
    );
    expect(retryIndexMigration).toContain(
      "(metadata ->> 'reconciliation_review_id')"
    );
    expect(retryIndexMigration).toContain(
      "metadata ->> 'merchant_invoice_partial_applied' = 'true'"
    );
    expect(retryIndexMigration).toContain(
      "lower(trim(COALESCE(gateway, ''))) = 'paystack'"
    );
  });
});
