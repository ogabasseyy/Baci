import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260905102100_enqueue_gigl_wallet_shipping_charge_reconciliation.sql'
  ),
  'utf8'
);

describe('enqueue gigl wallet shipping charge reconciliation migration', () => {
  it('adds the ambiguous charge issue type to reconciliation_review', () => {
    expect(sql).toContain("'gigl_wallet_shipping_charge_ambiguous'");
    expect(sql).toContain(
      'VALIDATE CONSTRAINT reconciliation_review_issue_type_check'
    );
  });

  it('enqueues an open review when a charge becomes needs_reconciliation', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.enqueue_gigl_wallet_shipping_charge_review()'
    );
    expect(sql).toContain("NEW.status = 'needs_reconciliation'");
    expect(sql).toContain(
      'AFTER INSERT OR UPDATE OF status ON public.merchant_shipping_charges'
    );
    expect(sql).toContain(
      'ON CONFLICT (issue_type, order_id)\n      WHERE resolved_at IS NULL AND order_id IS NOT NULL\n      DO NOTHING'
    );
  });
});
