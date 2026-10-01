-- Harden legacy receipt cleanup authorization and fix completion diagnostics.

CREATE OR REPLACE FUNCTION public.complete_legacy_expense_receipt_cleanup(
  p_expense_id uuid,
  p_merchant_id uuid,
  p_storage_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  IF p_expense_id IS NULL
     OR p_merchant_id IS NULL
     OR p_storage_path IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
  WHERE candidate.expense_id = p_expense_id
    AND candidate.merchant_id = p_merchant_id
    AND candidate.storage_path = p_storage_path;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.authorize_legacy_expense_receipt_cleanup_deletion(
  p_expense_id uuid,
  p_merchant_id uuid,
  p_storage_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_expense_id IS NULL
     OR p_merchant_id IS NULL
     OR p_storage_path IS NULL
     OR p_storage_path !~ ('^expenses/' || p_merchant_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$') THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
  WHERE candidate.expense_id = p_expense_id
    AND candidate.merchant_id = p_merchant_id
    AND candidate.storage_path = p_storage_path
    AND candidate.claimed_at IS NOT NULL
    AND candidate.claimed_at >= now() - interval '10 minutes'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expenses AS expense
    WHERE expense.receipt_url IS NOT NULL
      AND position('/object/public/media/' || p_storage_path IN expense.receipt_url) > 0
  ) THEN
    UPDATE private.expense_legacy_receipt_cleanup_candidates AS candidate
    SET claimed_at = NULL
    WHERE candidate.expense_id = p_expense_id
      AND candidate.merchant_id = p_merchant_id
      AND candidate.storage_path = p_storage_path;
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION private.block_claimed_legacy_expense_receipt_restoration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_storage_path text;
BEGIN
  IF NEW.receipt_url IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.receipt_url IS DISTINCT FROM OLD.receipt_url
     ) THEN
    v_storage_path := regexp_replace(
      NEW.receipt_url,
      '^.*?/object/public/media/',
      ''
    );

    IF v_storage_path IS DISTINCT FROM NEW.receipt_url
       AND EXISTS (
         SELECT 1
         FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
         WHERE candidate.storage_path = v_storage_path
           AND candidate.claimed_at IS NOT NULL
           AND candidate.claimed_at >= now() - interval '10 minutes'
       ) THEN
      RAISE EXCEPTION 'Legacy expense receipt is pending cleanup'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.block_claimed_legacy_expense_receipt_restoration()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS block_claimed_legacy_expense_receipt_restoration ON public.expenses;
CREATE TRIGGER block_claimed_legacy_expense_receipt_restoration
  BEFORE INSERT OR UPDATE OF receipt_url ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION private.block_claimed_legacy_expense_receipt_restoration();

REVOKE ALL ON FUNCTION public.authorize_legacy_expense_receipt_cleanup_deletion(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_legacy_expense_receipt_cleanup_deletion(uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_legacy_expense_receipt_cleanup(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_legacy_expense_receipt_cleanup(uuid, uuid, text)
  TO service_role;
