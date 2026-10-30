-- Isolated fixture only: construct an over-reversal that the production
-- insertion guard correctly rejects, then prove the read snapshot preserves
-- authorized history while returning earnings as unavailable.
BEGIN;
ALTER TABLE piggyvest_primary.paid_interest_reversals
  DISABLE TRIGGER primary_interest_reversal_guard;
INSERT INTO piggyvest_primary.paid_interest_reversals(
  integration_id, provider_reversal_id, payout_id, amount_kobo,
  provider_evidence_sha256, evidence_reference
) VALUES (
  '00000000-0000-4000-8000-000000000005', 'synthetic-over-reversal',
  'production-payout', 3500, repeat('e', 64), 'isolated regression fixture'
);
ALTER TABLE piggyvest_primary.paid_interest_reversals
  ENABLE TRIGGER primary_interest_reversal_guard;

SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
SET ROLE authenticated;
DO $$
DECLARE snapshot jsonb;
BEGIN
  BEGIN
    PERFORM public.get_customer_savings_earnings(
      '00000000-0000-4000-8000-000000000001', true
    );
    RAISE EXCEPTION 'Unsafe per-goal earnings unexpectedly became available';
  EXCEPTION WHEN SQLSTATE '22003' THEN NULL;
  END;

  snapshot := public.get_customer_savings_interest_snapshot(
    '00000000-0000-4000-8000-000000000001'
  );
  IF snapshot->>'earnings_available' IS DISTINCT FROM 'false'
    OR snapshot->'credited_interest_kobo' IS DISTINCT FROM 'null'::jsonb
    OR snapshot->'goal_interest_kobo' IS DISTINCT FROM '[]'::jsonb
    OR jsonb_typeof(snapshot->'interest_history') IS DISTINCT FROM 'array'
    OR NOT coalesce((snapshot->'interest_history') @> jsonb_build_array(
      jsonb_build_object(
        'id', 'primary:00000000-0000-4000-8000-000000000005:production-payout',
        'amount', 30,
        'type', 'credit'
      ),
      jsonb_build_object(
        'id', 'primary-reversal:00000000-0000-4000-8000-000000000005:synthetic-over-reversal',
        'amount', -35,
        'type', 'adjustment'
      )
    ), false) THEN
    RAISE EXCEPTION 'History did not survive an unsafe earnings projection: %', snapshot;
  END IF;
END;
$$;
RESET ROLE;
ROLLBACK;
