-- Durable cleanup queue for private expense-receipts objects cleared from expenses.

CREATE TABLE IF NOT EXISTS private.expense_private_receipt_cleanup_candidates (
  expense_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  PRIMARY KEY (expense_id, storage_path)
);

CREATE INDEX IF NOT EXISTS expense_private_receipt_cleanup_candidates_created_at_idx
  ON private.expense_private_receipt_cleanup_candidates (created_at);

ALTER TABLE private.expense_private_receipt_cleanup_candidates
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.expense_private_receipt_cleanup_candidates
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.queue_expense_private_receipt_cleanup(
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
     OR p_storage_path !~ (
       '^' || p_merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
     ) THEN
    RETURN false;
  END IF;

  IF NOT public.check_staff_permission(
    auth.uid(), p_merchant_id, 'expenses', 'edit'
  ) THEN
    RAISE EXCEPTION 'Not authorized to queue private expense receipt cleanup';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.expenses AS target_expense
    WHERE target_expense.id = p_expense_id
      AND target_expense.merchant_id = p_merchant_id
      AND (
        target_expense.receipt_storage_path IS NULL
        OR target_expense.receipt_storage_path <> p_storage_path
      )
  ) THEN
    RETURN false;
  END IF;

  IF private.expense_receipt_is_referenced(p_storage_path) THEN
    RETURN false;
  END IF;

  INSERT INTO private.expense_private_receipt_cleanup_candidates (
    expense_id, merchant_id, storage_path
  )
  VALUES (p_expense_id, p_merchant_id, p_storage_path)
  ON CONFLICT (expense_id, storage_path) DO UPDATE
    SET created_at = now(),
        claimed_at = NULL;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_expense_private_receipt_cleanup_candidates(
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  expense_id uuid,
  merchant_id uuid,
  storage_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Invalid private receipt cleanup batch limit';
  END IF;

  DELETE FROM private.expense_private_receipt_cleanup_candidates AS candidate
  WHERE candidate.storage_path !~ (
        '^' || candidate.merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
      )
     OR private.expense_receipt_is_referenced(candidate.storage_path);

  RETURN QUERY
  WITH to_claim AS (
    SELECT candidate.expense_id, candidate.merchant_id, candidate.storage_path
    FROM private.expense_private_receipt_cleanup_candidates AS candidate
    WHERE (candidate.claimed_at IS NULL OR candidate.claimed_at < now() - interval '10 minutes')
      AND candidate.storage_path ~ (
        '^' || candidate.merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
      )
      AND NOT private.expense_receipt_is_referenced(candidate.storage_path)
    ORDER BY candidate.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE private.expense_private_receipt_cleanup_candidates AS candidate
  SET claimed_at = now()
  FROM to_claim
  WHERE candidate.expense_id = to_claim.expense_id
    AND candidate.storage_path = to_claim.storage_path
  RETURNING candidate.expense_id, candidate.merchant_id, candidate.storage_path;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_expense_private_receipt_cleanup(
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

  DELETE FROM private.expense_private_receipt_cleanup_candidates AS candidate
  WHERE candidate.expense_id = p_expense_id
    AND candidate.merchant_id = p_merchant_id
    AND candidate.storage_path = p_storage_path;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.authorize_expense_private_receipt_cleanup_deletion(
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
     OR p_storage_path !~ (
       '^' || p_merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
     ) THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM private.expense_private_receipt_cleanup_candidates AS candidate
  WHERE candidate.expense_id = p_expense_id
    AND candidate.merchant_id = p_merchant_id
    AND candidate.storage_path = p_storage_path
    AND candidate.claimed_at IS NOT NULL
    AND candidate.claimed_at >= now() - interval '10 minutes'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF private.expense_receipt_is_referenced(p_storage_path) THEN
    UPDATE private.expense_private_receipt_cleanup_candidates AS candidate
    SET claimed_at = NULL
    WHERE candidate.expense_id = p_expense_id
      AND candidate.merchant_id = p_merchant_id
      AND candidate.storage_path = p_storage_path;
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION private.block_claimed_private_expense_receipt_restoration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.receipt_storage_path IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.receipt_storage_path IS DISTINCT FROM OLD.receipt_storage_path
     )
     AND EXISTS (
       SELECT 1
       FROM private.expense_private_receipt_cleanup_candidates AS candidate
       WHERE candidate.storage_path = NEW.receipt_storage_path
         AND candidate.claimed_at IS NOT NULL
         AND candidate.claimed_at >= now() - interval '10 minutes'
     ) THEN
    RAISE EXCEPTION 'Private expense receipt is pending cleanup'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.block_claimed_private_expense_receipt_restoration()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS block_claimed_private_expense_receipt_restoration ON public.expenses;
CREATE TRIGGER block_claimed_private_expense_receipt_restoration
  BEFORE INSERT OR UPDATE OF receipt_storage_path ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION private.block_claimed_private_expense_receipt_restoration();

REVOKE ALL ON FUNCTION public.queue_expense_private_receipt_cleanup(uuid, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_expense_private_receipt_cleanup(uuid, uuid, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.claim_expense_private_receipt_cleanup_candidates(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_expense_private_receipt_cleanup_candidates(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_expense_private_receipt_cleanup(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_expense_private_receipt_cleanup(uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.authorize_expense_private_receipt_cleanup_deletion(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_expense_private_receipt_cleanup_deletion(uuid, uuid, text)
  TO service_role;
