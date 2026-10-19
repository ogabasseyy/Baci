import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260912090700_uba_redvault_refund_lifecycle.sql'
  ),
  'utf8'
);
const reconciliationMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260912090800_uba_redvault_refund_reconciliation.sql'
  ),
  'utf8'
);
const captureReceiptGuardMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260912090900_uba_redvault_refund_capture_receipt_guard.sql'
  ),
  'utf8'
);

describe('REDVAULT refund lifecycle migration', () => {
  it('keeps private refund tables inaccessible and exposes RPCs only to service_role', () => {
    expect(migration).toContain(
      'ALTER TABLE private.uba_redvault_refund_line_allocations ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toContain(
      'REVOKE ALL ON private.uba_redvault_refund_line_allocations FROM PUBLIC, anon, authenticated, service_role'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.reserve_uba_redvault_refund[\s\S]*?FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.reserve_uba_redvault_refund[\s\S]*?TO service_role;/
    );
  });

  it('reserves original captures and persisted unit net amounts before provider work', () => {
    expect(migration).toContain(
      "v_attempt.state NOT IN ('captured_held', 'approved')"
    );
    expect(migration).toContain(
      'v_allocation.unit_price_kobo - v_allocation.allocation_kobo'
    );
    expect(migration).toContain(
      "state IN ('pending', 'processing', 'processed')"
    );
    expect(migration).toContain('uba_redvault_refund_unit_active_once');
  });

  it('does not re-claim processing response-loss requests and releases failed unit reservations', () => {
    expect(migration).toContain("WHERE refund.state = 'pending'");
    expect(migration).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain(
      'WHERE refund_id = p_refund_id AND released_at IS NULL'
    );
    expect(migration).toContain("p_outcome NOT IN ('failed', 'processed')");
  });

  it('persists known provider ids and reconciles them under a one-time claim', () => {
    expect(reconciliationMigration).toContain(
      'record_uba_redvault_refund_provider_submission'
    );
    expect(reconciliationMigration).toContain(
      'reconciliation_claim_token IS NULL'
    );
    expect(reconciliationMigration).toContain(
      'redvault_refund_reconciliation_claim_invalid'
    );
    expect(reconciliationMigration).toContain(
      "p_provider_status NOT IN ('pending', 'processed', 'failed')"
    );
  });

  it('fails closed when held capture evidence is mismatched or smaller than expected', () => {
    expect(captureReceiptGuardMigration).toContain(
      'v_capture_amount IS DISTINCT FROM v_attempt.amount_kobo'
    );
    expect(captureReceiptGuardMigration).toContain(
      "v_capture_status IS DISTINCT FROM 'success'"
    );
    expect(captureReceiptGuardMigration).toContain(
      "'provider_eligibility_evidence_unavailable'"
    );
    expect(captureReceiptGuardMigration).toContain(
      "RAISE EXCEPTION 'redvault_refund_capture_evidence_mismatch'"
    );
    expect(captureReceiptGuardMigration).toContain(
      'v_amount := v_capture_amount'
    );
  });
});
