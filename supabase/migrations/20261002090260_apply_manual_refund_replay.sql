-- Manual-refund replay: idempotent retries of an already recorded
-- transfer, extracted from the manager so it stays under the
-- 300-line limit. Same transfer (matching money fields) refreshes a
-- differing note as an annotation correction and returns 'status';
-- mismatched money raises manual_reference_conflict; no prior rows
-- returns 'manual' so the record helper runs. Called only from
-- private.manage_order_refund after the confirmation attestation, so
-- unattested callers never reach the note rewrite. When the caller
-- passes p_note_frozen (worker holds the step claimed/uncertain, or
-- pending/movement evidence exists), the note rewrite is skipped but
-- the idempotent status read-back still succeeds: audit metadata
-- stays frozen in exactly the states the processing gate protects.
-- Lookup and rewrite scope by merchant and terminal status like the
-- manager: a cross-merchant row must never produce a false replay
-- or conflict, failed rows are not recorded transfers (retrying one
-- records fresh), and the note rewrite touches only matched rows.
DROP FUNCTION IF EXISTS private.apply_manual_refund_replay_v1(uuid,numeric,timestamptz,text,text,text);
DROP FUNCTION IF EXISTS private.apply_manual_refund_replay_v1(uuid,numeric,timestamptz,text,text,text,boolean);
CREATE OR REPLACE FUNCTION private.apply_manual_refund_replay_v1(
  p_order_id uuid, p_amount numeric, p_refunded_at timestamptz,
  p_method text, p_reference text, p_note text,
  p_merchant_id uuid, p_note_frozen boolean DEFAULT false
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_replay jsonb;
BEGIN
  -- Replay identity normalizes like the coverage paths: a legacy
  -- 'Manual' spelling or padded reference is the same transfer.
  SELECT jsonb_build_object('amount',sum(amount),'method',min(metadata->>'method'),
    'refunded_at',min(metadata->>'refunded_at'),'note',min(metadata->>'note')) INTO v_replay
    FROM public.transactions WHERE order_id=p_order_id AND merchant_id=p_merchant_id
    AND transaction_type='refund' AND status IN ('completed','refunded')
    AND public.normalized_gateway_name_v1(gateway)='MANUAL'
    AND btrim(metadata->>'reference')=NULLIF(btrim(p_reference),'');
  IF (v_replay->>'amount') IS NOT NULL THEN
    IF (v_replay->>'amount')::numeric<>p_amount OR v_replay->>'method'<>p_method
      OR (v_replay->>'refunded_at')::timestamptz<>p_refunded_at THEN
      RAISE EXCEPTION 'manual_reference_conflict' USING ERRCODE='P0001';
    END IF;
    -- Same transfer: money fields match, so no new money moves. A
    -- differing note is an annotation correction, not a new
    -- transfer (a new reference would double-record the money),
    -- so refresh it on every leg row instead of keeping stale
    -- audit text — unless the caller froze notes (claimed step or
    -- pending evidence), in which case the correction waits.
    IF NOT COALESCE(p_note_frozen,false)
      AND COALESCE(v_replay->>'note','') IS DISTINCT FROM COALESCE(p_note,'') THEN
      UPDATE public.transactions SET metadata = metadata ||
        jsonb_build_object('note',p_note)
        WHERE order_id=p_order_id AND merchant_id=p_merchant_id
          AND transaction_type='refund' AND status IN ('completed','refunded')
          AND public.normalized_gateway_name_v1(gateway)='MANUAL'
          AND btrim(metadata->>'reference')=NULLIF(btrim(p_reference),'');
    END IF;
    RETURN 'status'; -- Idempotent retry of an already recorded transfer.
  END IF;
  RETURN 'manual';
END; $$;
REVOKE ALL ON FUNCTION private.apply_manual_refund_replay_v1(uuid,numeric,timestamptz,text,text,text,uuid,boolean)
  FROM PUBLIC,anon,authenticated;
-- Mirrors record_manual_order_refund: service_role fires the manager,
-- and authenticated EXECUTE keeps any hypothetical direct call on the
-- clean schema-USAGE denial instead of the crashing function-ACL path.
GRANT EXECUTE ON FUNCTION private.apply_manual_refund_replay_v1(uuid,numeric,timestamptz,text,text,text,uuid,boolean)
  TO service_role, authenticated;
