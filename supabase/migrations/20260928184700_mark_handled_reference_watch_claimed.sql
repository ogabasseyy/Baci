-- Retain handled reference watches for future matching completions.
-- A reference-only event whose current matches are durably handled
-- must stop the sweep from re-driving the watch every run (the
-- retire RPC refuses any watch whose reference has a completed
-- payment, so handled watches would live forever in the bounded
-- sweep) — but resolving drops the handoff a later completion
-- sharing the reference needs to file its own per-payment evidence.
-- Claimed is both sweep-silent and completion-visible: the sweep
-- selects open rows only, while the completion claim matches claimed
-- reference watches and files idempotently per payment. This flips
-- the caller's open watch to claimed under the same reference
-- advisory lock; a no-op (false) when no open reference watch
-- exists, so redelivery replays stay silent.
CREATE OR REPLACE FUNCTION public.mark_paystack_refund_reference_watch_claimed_v1(
  p_paystack_ref text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reference text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  v_reference := nullif(btrim(coalesce(p_paystack_ref, '')), '');
  IF v_reference IS NULL THEN
    RAISE EXCEPTION 'invalid_refund_recovery_watch' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'baci_paystack_refund_watch:' || v_reference, 0)
  );
  UPDATE public.paystack_refund_recovery_watch
    SET status = 'claimed', updated_at = now()
    WHERE paystack_ref = v_reference
      AND provider_refund_id IS NULL
      AND status = 'open';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_paystack_refund_reference_watch_claimed_v1(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_paystack_refund_reference_watch_claimed_v1(text)
  TO service_role;
