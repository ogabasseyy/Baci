-- Atomic replay overlay for mutable VTU attempt attributes (Codex R32
-- f8Zk/f8Z0). The wallet-only replay path must refresh `customerPhone`
-- (corrections / late-hydrated profile phones) and `validationReference`
-- (re-verification issues a new one; the attempt-1 reference expires)
-- before re-driving fulfillment. A client-side SELECT-merge-UPDATE would
-- race concurrent metadata writers (fulfillment settlement markers,
-- voucher backfill) and clobber their keys with a stale snapshot, so
-- the patch happens here in a single UPDATE: only the provided (non-blank)
-- fields are merged, every other metadata key is untouched.
--
-- SECURITY DEFINER is limited to service_role-only replay repair; search_path
-- is pinned to prevent injection through caller-controlled schemas.
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
  WHERE id = p_transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_vtu_transaction_replay_attributes(uuid, text, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_vtu_transaction_replay_attributes(uuid, text, text)
TO service_role;
