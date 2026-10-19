-- Limit replay attribute overlays to pending rows (Codex R42 rm5aj).
--
-- Supersedes 20261012143500_set_vtu_transaction_replay_attributes.sql
-- (body copied verbatim except the added status gate; the original
-- file is left untouched so applied histories keep matching their
-- checksums).
--
-- Background: the status-agnostic UPDATE let a replay racing an
-- in-flight fulfillment bump updated_at on the processing row —
-- invalidating the original request's post-claim compare-and-set
-- token. If the original debit then failed without a ledger entry,
-- both the inline restore (zero rows matched) and the ledger-gated
-- reconciler (no debit) refused to recover it, stranding that
-- idempotency key in processing forever.
--
-- Terminal and actively processing rows never consume overlaid
-- attributes (in-flight fulfillment holds its own snapshot;
-- terminal rows are done), so the patch now applies only while the
-- row is pending. A missing row still raises P0002 (caller bug); an
-- existing non-pending row is a silent no-op (best-effort
-- freshening with nothing to freshen for).
--
-- Same signature as the original: CREATE OR REPLACE is safe, and
-- grants are re-asserted for explicitness.
CREATE OR REPLACE FUNCTION public.set_vtu_transaction_replay_attributes(
  p_transaction_id uuid,
  p_customer_phone text,
  p_validation_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := NULLIF(BTRIM(p_customer_phone), '');
  v_reference text := NULLIF(BTRIM(p_validation_reference), '');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.vtu_transactions WHERE id = p_transaction_id
  ) THEN
    RAISE EXCEPTION 'VTU transaction % not found while setting replay attributes',
      p_transaction_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_phone IS NULL AND v_reference IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.vtu_transactions
  SET metadata = COALESCE(metadata, '{}'::jsonb)
    || CASE WHEN v_phone IS NULL
      THEN '{}'::jsonb
      ELSE jsonb_build_object('customerPhone', v_phone)
    END
    || CASE WHEN v_reference IS NULL
      THEN '{}'::jsonb
      ELSE jsonb_build_object('validationReference', v_reference)
    END
  WHERE id = p_transaction_id
    AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.set_vtu_transaction_replay_attributes(uuid, text, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_vtu_transaction_replay_attributes(uuid, text, text)
TO service_role;
