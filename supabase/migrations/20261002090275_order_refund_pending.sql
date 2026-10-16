-- Pending refund evidence helper: the manager's global pending sum
-- as a reviewable unit, split from the manager (part 4) so each
-- migration stays under the 300-line limit. Called only from
-- private.manage_order_refund, which runs SECURITY DEFINER; this
-- stays SECURITY INVOKER.
-- LOAD-BEARING CONFINEMENT: this helper takes p_merchant_id as a
-- caller-supplied argument with no auth check of its own, and it is
-- GRANTed EXECUTE to authenticated (the grant exists only to dodge
-- the Postgres 18 denial-path segfault). It stays unreachable solely
-- because the private schema denies USAGE to authenticated — never
-- grant private USAGE for an unrelated helper without adding an
-- in-function authorization check here first. The confinement suite
-- (order_refund_coverage_helper_confinement.sql, required in CI)
-- pins the denial; keep it green.
DROP FUNCTION IF EXISTS private.pending_refund_evidence_v1(uuid,uuid,text,boolean,text);
CREATE OR REPLACE FUNCTION private.pending_refund_evidence_v1(
  p_order_id uuid, p_merchant_id uuid, p_currency text,
  p_sole_external_leg boolean, p_sole_leg_gateway text
) RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  -- Pending stays a global sum: over-counting in-flight money only
  -- blocks actions safely. Nonmatching-currency rows (null or
  -- foreign) stay out of coverage but count as pending: the manager
  -- cannot convert money, so an unexplained linked row must block
  -- recording until reconciliation instead of leaving the full
  -- balance recordable beside it (double-record). No currency
  -- filtering on the scan for this reason: it would drop the row
  -- from both sums.
  -- Amounts carry no positivity constraint, so non-positive rows
  -- floor at one unit: a zero row would otherwise vanish and a
  -- negative row could cancel real in-flight money, opening
  -- recording the executor would refuse. Honest positive sums stay
  -- exact; corrupt rows pin the gate instead of erasing evidence.
  -- A locally failed provider row stays pending until a fresh
  -- provider check stamps non-acceptance: the verified-record
  -- function still accepts a later processed verdict for it, so
  -- an out-of-order or corrected provider event could complete
  -- the same money after a manual recovery (double-pay). Only
  -- rows carrying a provider refund id gate: without one no
  -- verdict can ever land (the record function requires it), so
  -- the row is provably dead. Other gateways keep local-status
  -- trust and only provider-declared manuals join the gate,
  -- mirroring the unverified arm below.
  RETURN (SELECT
    COALESCE(sum(CASE WHEN COALESCE(amount,0) <= 0 THEN 1 ELSE amount END) FILTER (WHERE status NOT IN ('completed','refunded','failed')
      OR (status = 'failed'
        AND gateway_reference ~ '^[0-9]+$'
        AND (public.normalized_gateway_name_v1(gateway) IS NOT DISTINCT FROM 'PAYSTACK'
          OR (public.normalized_gateway_name_v1(gateway)='MANUAL'
            AND metadata->>'method'='paystack'))
        AND metadata->>'provider_refund_status' IS DISTINCT FROM 'failed')
      OR (status IN ('completed','refunded')
        AND (public.normalized_gateway_name_v1(gateway) IS NOT DISTINCT FROM 'PAYSTACK'
          OR (public.normalized_gateway_name_v1(gateway)='MANUAL'
            AND metadata->>'method'='paystack'))
        AND metadata->>'provider_refund_status' IS DISTINCT FROM 'processed')
      OR (status IN ('completed','refunded')
        AND upper(btrim(currency)) IS DISTINCT FROM upper(btrim(
          COALESCE(NULLIF(BTRIM(p_currency),''),'NGN'))))
      OR (status IN ('completed','refunded')
        AND NOT COALESCE((EXISTS (SELECT 1 FROM public.transactions leg
            WHERE leg.id::text = transactions.metadata->>'payment_transaction_id'
              AND leg.order_id=p_order_id AND leg.merchant_id=p_merchant_id
              AND leg.transaction_type='payment'
              AND leg.status IN ('completed','refund_pending','refunded')
              AND (public.normalized_gateway_name_v1(transactions.gateway)='MANUAL'
                OR public.normalized_gateway_name_v1(transactions.gateway)
                  =public.normalized_gateway_name_v1(leg.gateway)))
          OR (transactions.metadata->>'payment_transaction_id' IS NULL
            AND p_sole_external_leg
            AND public.normalized_gateway_name_v1(gateway)=p_sole_leg_gateway)),false))),0)
    FROM public.transactions
    WHERE order_id=p_order_id AND merchant_id=p_merchant_id AND transaction_type='refund'
  );
  -- No link predicate above: a row claiming a leg outside this
  -- order (or otherwise unresolvable) must reach the FILTER's
  -- mismatch branch and hold pending, not vanish from both sums.
  -- Excluding it would leave the full balance recordable beside
  -- possibly real provider money (double-record) while the claim
  -- finalizes past evidence nothing ever reconciles. The mismatch
  -- test compares links as text so a malformed link blocks
  -- instead of raising.
END; $$;
REVOKE ALL ON FUNCTION private.pending_refund_evidence_v1(uuid,uuid,text,boolean,text)
  FROM PUBLIC,anon,authenticated;
-- Mirrors the record helper: service_role fires the manager, and
-- authenticated EXECUTE keeps any hypothetical direct call on the
-- clean schema-USAGE denial instead of the crashing function-ACL path.
GRANT EXECUTE ON FUNCTION private.pending_refund_evidence_v1(uuid,uuid,text,boolean,text)
  TO service_role, authenticated;
CREATE OR REPLACE FUNCTION private.unresolved_order_movement_evidence_v1(
  p_order_id uuid,
  p_merchant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
-- Order-wide port of collectUnresolved.../reviewHasEvidence: open
-- movement reviews pin legs exactly like pending evidence, and the
-- manager is the manual path, so it runs the same gate. Tracked
-- entries mirror the app tracker (a carrying outside review scans
-- everything; otherwise only entries with a strict nested
-- audit_record_failed flag), markers compare as jsonb so a
-- malformed flag never raises, and the failed-only escape keeps a
-- refused provider refund from stranding an order no reconciler
-- ever revisits.
DECLARE
  r record;
  v_evidence jsonb;
  v_entries_total integer;
  v_entries_failed integer;
  v_carries boolean;
  v_top_marker boolean;
  v_nested_marker boolean;
  v_txn uuid;
  v_leg uuid;
  v_named_nonempty boolean;
  v_failed_only_nonempty boolean;
  v_failed_only_ids text[];
BEGIN
  FOR r IN
    SELECT rr.id, rr.issue_type, rr.txn_id, rr.candidates, rr.metadata
    FROM public.reconciliation_review rr
    WHERE rr.order_id = p_order_id
      AND rr.merchant_id = p_merchant_id
      AND rr.issue_type IN (
        'order_cancellation_refund_requires_review',
        'provider_refund_outside_cancellation')
      AND rr.resolved_at IS NULL
  LOOP
    v_evidence := CASE
      WHEN jsonb_typeof(r.metadata -> 'refund_evidence') = 'object'
      THEN r.metadata -> 'refund_evidence'
      ELSE '{}'::jsonb
    END;
    SELECT count(*),
      count(*) FILTER (WHERE lower(btrim(
        coalesce(e.value ->> 'provider_refund_status', ''))) = 'failed')
    INTO v_entries_total, v_entries_failed
    FROM jsonb_each(v_evidence) e;
    v_carries := r.issue_type = 'provider_refund_outside_cancellation'
      AND (v_entries_total = 0 OR v_entries_failed < v_entries_total);
    v_top_marker := coalesce(
      (r.metadata -> 'audit_record_failed') = 'true'::jsonb, false);
    SELECT coalesce(bool_or(
        v_carries
        OR coalesce(
          (e.value -> 'audit_record_failed') = 'true'::jsonb, false)),
      false)
    INTO v_nested_marker
    FROM jsonb_each(v_evidence) e;
    IF NOT (v_top_marker OR v_nested_marker OR v_carries) THEN
      CONTINUE;
    END IF;
    -- Legs every tracked nested entry explicitly failed: the
    -- provider definitively moved no money there, so (like the
    -- TypeScript reader) they leave the named set below instead of
    -- blocking recovery on evidence that can never pay out.
    SELECT COALESCE(array_agg(failed.raw), '{}'::text[])
      INTO v_failed_only_ids
      FROM (
        SELECT legs.raw AS raw
        FROM jsonb_each(v_evidence) e
        CROSS JOIN LATERAL (
          SELECT e.value ->> 'payment_transaction_id' AS raw
          UNION ALL
          SELECT jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(
              e.value -> 'candidate_payment_transaction_ids') = 'array'
            THEN e.value -> 'candidate_payment_transaction_ids'
            ELSE '[]'::jsonb END)) legs
        WHERE legs.raw IS NOT NULL
          AND (v_carries
            OR coalesce(
              (e.value -> 'audit_record_failed') = 'true'::jsonb, false))
        GROUP BY legs.raw
        HAVING bool_and(lower(btrim(coalesce(
          e.value ->> 'provider_refund_status', ''))) = 'failed')
      ) failed;
    v_txn := r.txn_id;
    BEGIN
      v_leg := (r.metadata ->> 'payment_transaction_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_leg := NULL;
    END;
    SELECT coalesce(bool_or(
        (c.value ->> 'paymentTransactionId' IS NOT NULL
          AND NOT (c.value ->> 'paymentTransactionId'
            = ANY (v_failed_only_ids)))
        OR (c.value ->> 'payment_transaction_id' IS NOT NULL
          AND NOT (c.value ->> 'payment_transaction_id'
            = ANY (v_failed_only_ids)))), false)
      OR EXISTS (
        SELECT 1
        FROM jsonb_each(v_evidence) e
        CROSS JOIN LATERAL (
          SELECT e.value ->> 'payment_transaction_id' AS raw
          UNION ALL
          SELECT jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(
              e.value -> 'candidate_payment_transaction_ids') = 'array'
            THEN e.value -> 'candidate_payment_transaction_ids'
            ELSE '[]'::jsonb END)) legs
        WHERE legs.raw IS NOT NULL
          AND lower(btrim(coalesce(
            e.value ->> 'provider_refund_status', ''))) <> 'failed'
          AND (v_carries
            OR coalesce(
              (e.value -> 'audit_record_failed') = 'true'::jsonb, false)))
    INTO v_named_nonempty
    FROM jsonb_array_elements(CASE
      WHEN jsonb_typeof(coalesce(r.candidates, '[]'::jsonb)) = 'array'
      THEN coalesce(r.candidates, '[]'::jsonb)
      ELSE '[]'::jsonb END) c;
    v_failed_only_nonempty := v_failed_only_ids <> '{}'::text[];
    IF (v_txn IS NOT NULL
        AND NOT (v_txn::text = ANY (v_failed_only_ids)))
      OR (v_leg IS NOT NULL
        AND NOT (v_leg::text = ANY (v_failed_only_ids)))
      OR v_named_nonempty
      OR NOT v_failed_only_nonempty THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END; $$;
REVOKE ALL ON FUNCTION private.unresolved_order_movement_evidence_v1(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.unresolved_order_movement_evidence_v1(uuid,uuid)
  TO service_role, authenticated;
CREATE OR REPLACE FUNCTION private.manual_refund_partial_v1(
  p_order_id uuid,
  p_remaining numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
-- Per-leg partial-manual state, mirroring the executor's coverage
-- matcher: a fully manually covered leg never blocks retry (the
-- matcher marks it refunded and skips it), but a partially covered
-- leg still needs the merchant to finish before the worker moves.
-- Currency compares row-vs-leg like the matcher (never order-wide),
-- and unverified Paystack declarations never count as matched.
-- Unlinked manual rows need no branch here: the pending helper
-- counts them (manual rows never sole-attribute), so the pending
-- gate owns them before retry is ever considered.
DECLARE
  v_partial boolean;
BEGIN
  SELECT p_remaining > 0 AND EXISTS (
      SELECT 1
      FROM public.transactions leg
      WHERE leg.order_id = p_order_id
        AND leg.transaction_type = 'payment'
        AND leg.amount > 0
        AND EXISTS (
          SELECT 1
          FROM public.transactions m
          WHERE m.order_id = p_order_id
            AND m.transaction_type = 'refund'
            AND m.status IN ('completed', 'refunded')
            AND public.normalized_gateway_name_v1(m.gateway) = 'MANUAL'
            AND m.metadata ->> 'payment_transaction_id' = leg.id::text)
        AND (SELECT COALESCE(SUM(m.amount), 0)
          FROM public.transactions m
          WHERE m.order_id = p_order_id
            AND m.transaction_type = 'refund'
            AND m.status IN ('completed', 'refunded')
            AND public.normalized_gateway_name_v1(m.gateway) = 'MANUAL'
            AND m.metadata ->> 'payment_transaction_id' = leg.id::text
            AND UPPER(BTRIM(m.currency)) = UPPER(BTRIM(leg.currency))
            AND (m.metadata ->> 'method' IS DISTINCT FROM 'paystack'
              OR m.metadata ->> 'provider_refund_status' = 'processed')
        ) < leg.amount
    )
  INTO v_partial;
  RETURN v_partial;
END; $$;
REVOKE ALL ON FUNCTION private.manual_refund_partial_v1(uuid,numeric)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.manual_refund_partial_v1(uuid,numeric)
  TO service_role, authenticated;
